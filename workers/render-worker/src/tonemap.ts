/**
 * Tonemapping pipeline: density estimation → gaussian blur → color grading → sRGB pixels.
 * Mirrors the WebGPU post-processing chain in pure TypeScript.
 */

import { BUCKET_FIXED_POINT_MULTIPLIER_INV } from './types.ts'

const { PI, sin, cos, sqrt, exp, log, pow, abs, max, min, floor, ceil, round } =
  Math

// ---- OkLab ↔ sRGB conversions ----

interface OkLab {
  L: number
  a: number
  b: number
}

interface RGB {
  r: number
  g: number
  b: number
}

function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return 12.92 * c
  return 1.055 * pow(c, 1 / 2.4) - 0.055
}

export function oklabToRgb(L: number, a: number, b: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l3 = l_ * l_ * l_
  const m3 = m_ * m_ * m_
  const s3 = s_ * s_ * s_
  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const rd = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  return {
    r: linearToSrgb(r),
    g: linearToSrgb(g),
    b: linearToSrgb(rd),
  }
}

// ---- gamma-corrected sRGB for PNG ----

function to8bit(c: number): number {
  return max(0, min(255, round(c * 255)))
}

// ---- gaussian blur ----

function gaussianKernel(sigma: number, radius: number): Float64Array {
  const size = 2 * radius + 1
  const kernel = new Float64Array(size)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const w = exp((-i * i) / (2 * sigma * sigma))
    kernel[i + radius] = w
    sum += w
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum
  return kernel
}

function blurPass(
  input: Float64Array,
  width: number,
  height: number,
  sigma: number,
  horizontal: boolean,
): Float64Array {
  const stride = 4
  const output = new Float64Array(input.length)
  const radius = max(1, min(36, ceil(sigma * 3)))
  const kernel = gaussianKernel(sigma, radius)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * stride
      let c0 = 0, c1 = 0, c2 = 0

      for (let k = -radius; k <= radius; k++) {
        const sx = horizontal ? x + k : x
        const sy = horizontal ? y : y + k
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue
        const sidx = (sy * width + sx) * stride
        const w = kernel[k + radius]!
        c0 += input[sidx]! * w
        c1 += input[sidx + 1]! * w
        c2 += input[sidx + 2]! * w
      }

      output[idx] = c0
      output[idx + 1] = c1
      output[idx + 2] = c2
    }
  }

  return output
}

// ---- palette entry type ----

interface PaletteEntry {
  a: number
  b: number
  chroma: number
}

// ---- tonemapping parameters ----

interface TonemapParams {
  exposure: number
  contrast: number
  vibrancy: number
  gamma: number
  brightness: number
  highlightPower: number
  paletteEntries?: PaletteEntry[]
  paletteMode: number // 0 = standard, 1 = flam3 hue rotation
  paletteSpeed: number
  palettePhase: number
  backgroundColor: RGB
  edgeFadeColor: RGB
  outputAlpha: number
}

function defaultTonemapParams(
  hasPalette: boolean,
): TonemapParams {
  return {
    exposure: 1.2,
    contrast: 1.5,
    vibrancy: 1.0,
    gamma: 2.2,
    brightness: 0,
    highlightPower: 0.3,
    paletteEntries: undefined,
    paletteMode: 0,
    paletteSpeed: 1.0,
    palettePhase: 0.0,
    backgroundColor: { r: 0, g: 0, b: 0 },
    edgeFadeColor: { r: 0, g: 0, b: 0 },
    outputAlpha: 1.0,
  }
}

// ---- main tonemap function ----

export function tonemapAndColorGrade(
  buckets: Float64Array,
  width: number,
  height: number,
  totalPoints: number,
  palette?: { entries: PaletteEntry[] },
  brightness?: number,
  gamma?: number,
  vibrancy?: number,
): Uint8Array {
  const stride = 4
  const pixels = new Uint8Array(width * height * 4)
  const params = defaultTonemapParams(!!palette)

  if (brightness !== undefined) params.brightness = brightness
  if (gamma !== undefined) params.gamma = gamma
  if (vibrancy !== undefined) params.vibrancy = vibrancy
  if (palette?.entries.length) {
    params.paletteEntries = palette.entries
  }

  // Calculate average count per bucket for normalization
  let totalCount = 0
  let activeBuckets = 0
  for (let i = 0; i < buckets.length; i += stride) {
    const c = buckets[i]! * BUCKET_FIXED_POINT_MULTIPLIER_INV
    totalCount += c
    if (c > 0) activeBuckets++
  }
  const avgCount = activeBuckets > 0 ? totalCount / activeBuckets : 1

  // Density estimation (simplified: use local average as sigma estimate)
  const sigmas = new Float64Array(width * height)
  const kernelRadius = 1 // 3x3 neighborhood
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, n = 0
      for (let dy = -kernelRadius; dy <= kernelRadius; dy++) {
        for (let dx = -kernelRadius; dx <= kernelRadius; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            sum += buckets[(ny * width + nx) * stride]! * BUCKET_FIXED_POINT_MULTIPLIER_INV
            n++
          }
        }
      }
      const avgDensity = n > 0 ? sum / n : 0
      const qualityK = 0.4
      const estimatorCurve = 1.0
      const sigma = max(0.5, min(12, qualityK * pow(max(avgDensity, 0.001), -estimatorCurve)))
      sigmas[y * width + x] = sigma
    }
  }

  // Average sigma for blur
  let avgSigma = 0
  for (let i = 0; i < sigmas.length; i++) avgSigma += sigmas[i]!
  avgSigma /= sigmas.length
  avgSigma = max(0.8, min(4, avgSigma))

  // Apply separable gaussian blur
  let blurred = blurPass(buckets, width, height, avgSigma, true)
  blurred = blurPass(blurred, width, height, avgSigma, false)

  // Color grading per pixel
  const paletteEntries = params.paletteEntries
  const hasPalette = paletteEntries && paletteEntries.length > 1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * stride
      const count = max(0, blurred[idx]! * BUCKET_FIXED_POINT_MULTIPLIER_INV)
      const colorA = blurred[idx + 1]! * BUCKET_FIXED_POINT_MULTIPLIER_INV
      const colorB = blurred[idx + 2]! * BUCKET_FIXED_POINT_MULTIPLIER_INV

      const pixelIdx = (y * width + x) * 4

      if (count <= 0.001) {
        pixels[pixelIdx] = to8bit(params.backgroundColor.r)
        pixels[pixelIdx + 1] = to8bit(params.backgroundColor.g)
        pixels[pixelIdx + 2] = to8bit(params.backgroundColor.b)
        pixels[pixelIdx + 3] = 255
        continue
      }

      // Normalize count
      const adjustedCount = count / max(avgCount, 0.001)

      // Log-density tonemapping
      const logDensity = log(adjustedCount * params.exposure + 1)
      let toneValue = max(0, min(1, logDensity * params.contrast))

      // Palette color lookup
      let finalA = colorA
      let finalB = colorB

      if (hasPalette) {
        const entries = paletteEntries!
        const normVal = adjustedCount / max(avgCount, 1)
        const logNorm = log(normVal * params.exposure + 1) * params.contrast

        const scale = 0.3 * params.paletteSpeed
        const phase = params.palettePhase
        let lookupVal: number

        if (params.paletteMode === 1) {
          lookupVal = logNorm * scale
        } else {
          lookupVal = (logNorm * scale + phase) % 1
        }
        if (lookupVal < 0) lookupVal += 1

        // Binary search for palette entry pair
        const entryCount = entries.length
        const entryIdx = min(entryCount - 1, floor(lookupVal * entryCount))
        const nextIdx = (entryIdx + 1) % entryCount
        const frac = (lookupVal * entryCount) - entryIdx

        const entryA = entries[entryIdx]!
        const entryB = entries[nextIdx]!

        let palA = entryA.a + (entryB.a - entryA.a) * frac
        let palB = entryA.b + (entryB.b - entryA.b) * frac

        if (params.paletteMode === 1) {
          const hueAngle = lookupVal * PI * 2
          const cosH = cos(hueAngle)
          const sinH = sin(hueAngle)
          const ra = palA
          const rb = palB
          palA = ra * cosH - rb * sinH
          palB = ra * sinH + rb * cosH
        }

        const mixFactor = 0.65
        finalA = colorA * (1 - mixFactor) + palA * mixFactor
        finalB = colorB * (1 - mixFactor) + palB * mixFactor
      }

      // Apply vibrancy (chroma multiplier)
      finalA *= params.vibrancy
      finalB *= params.vibrancy

      // Gamma correction
      const gammaCorrected = pow(toneValue, 1 / params.gamma)

      // Convert OkLab to RGB
      const rgb = oklabToRgb(gammaCorrected, finalA, finalB)

      // Highlight desaturation
      if (toneValue > 0.9) {
        const factor = ((toneValue - 0.9) / 0.1) * params.highlightPower
        const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b
        const desat = (1 - factor) + factor
        rgb.r = rgb.r * (1 - factor) + lum * factor
        rgb.g = rgb.g * (1 - factor) + lum * factor
        rgb.b = rgb.b * (1 - factor) + lum * factor
      }

      pixels[pixelIdx] = to8bit(rgb.r)
      pixels[pixelIdx + 1] = to8bit(rgb.g)
      pixels[pixelIdx + 2] = to8bit(rgb.b)
      pixels[pixelIdx + 3] = 255
    }
  }

  return pixels
}
