/**
 * Core CPU IFS rendering pipeline.
 * Mirrors the WebGPU pipeline: point init → skip-iters → IFS loop → accumulate → tonemap.
 */

import type { AffineCoefs, Bucket, Transform, VariationParams } from './types.ts'
import { BUCKET_FIXED_POINT_MULTIPLIER } from './types.ts'
import { Xoroshiro64, hashString } from './rng.ts'
import { applyTransform, transformAffine } from './variations.ts'

const { PI, sin, cos, sqrt, log, atan2, floor } = Math

// ---- flame descriptor input types ----

export interface FlameTransform {
  preAffine: AffineCoefs
  postAffine: AffineCoefs
  variations: VariationParams[]
  color: [number, number]
  colorSpeed: number
  weight: number
}

export interface FlameDescriptor {
  transforms: FlameTransform[]
  name?: string
  palette?: { entries: Array<{ a: number; b: number; chroma: number }> }
  brightness?: number
  gamma?: number
  vibrancy?: number
}

export interface RenderOptions {
  width: number
  height: number
  quality: number // 0-1, controls point count
  seed: string
  skipIters?: number
}

// ---- camera ----

interface Camera2D {
  centerX: number
  centerY: number
  rotation: number
  zoom: number
  width: number
  height: number
}

function defaultCamera(w: number, h: number): Camera2D {
  return { centerX: 0, centerY: 0, rotation: 0, zoom: 1, width: w, height: h }
}

function worldToScreen(
  x: number,
  y: number,
  cam: Camera2D,
): [number, number] {
  const cosR = cos(-cam.rotation)
  const sinR = sin(-cam.rotation)
  const dx = x - cam.centerX
  const dy = y - cam.centerY
  const rx = dx * cosR - dy * sinR
  const ry = dx * sinR + dy * cosR
  const nw = cam.width / cam.zoom
  const nh = cam.height / cam.zoom
  return [
    ((rx / nw) + 0.5) * cam.width,
    ((ry / nh) + 0.5) * cam.height,
  ]
}

// ---- point init modes ----

type PointInitFn = (rng: Xoroshiro64) => [number, number]

function pointInitCircle(rng: Xoroshiro64): [number, number] {
  const r = sqrt(rng.next())
  const theta = rng.next() * 2 * PI
  return [r * cos(theta), r * sin(theta)]
}

const POINT_INIT_MODES: Record<string, PointInitFn> = {
  pointInitCircle,
  pointInitUnitDisk: pointInitCircle,
  pointInitSquare: (rng) => [rng.next() * 2 - 1, rng.next() * 2 - 1],
  pointInitUnitSquare: (rng) => [rng.next() * 2 - 1, rng.next() * 2 - 1],
  pointInitGaussian: (rng) => {
    const u1 = rng.next() + 1e-6
    const u2 = rng.next()
    const sigma = 0.4
    const radius = sigma * sqrt(-2 * log(u1))
    const theta = u2 * 2 * PI
    return [radius * cos(theta), radius * sin(theta)]
  },
  pointInitGaussianDisk: (rng) => {
    const u1 = rng.next() + 1e-6
    const u2 = rng.next()
    const sigma = 0.4
    const radius = sigma * sqrt(-2 * log(u1))
    const theta = u2 * 2 * PI
    return [radius * cos(theta), radius * sin(theta)]
  },
  pointInitGaussianSquare: (rng) => {
    const u1 = rng.next() + 1e-6
    const u2 = rng.next()
    const sigma = 0.4
    const radius = sigma * sqrt(-2 * log(u1))
    const theta = u2 * 2 * PI
    return [radius * cos(theta), radius * sin(theta)]
  },
  pointInitHalton: (rng) => {
    let i = rng.nextU32()
    function halton(idx: number, base: number): number {
      let f = 1.0
      let r = 0.0
      while (idx > 0) {
        f = f / base
        r = r + f * (idx % base)
        idx = floor(idx / base)
      }
      return r
    }
    return [halton(i + 1, 2) * 2 - 1, halton(i + 1, 3) * 2 - 1]
  },
}

// ---- IFS iteration result ----

export interface RenderResult {
  buckets: Float64Array // flat [count, colorA, colorB, padding] per pixel
  width: number
  height: number
  totalPoints: number
}

// ---- quality → point count mapping ----

function qualityToPointCount(quality: number): number {
  if (quality <= 0.1) return 50_000
  if (quality <= 0.3) return 200_000
  if (quality <= 0.5) return 500_000
  if (quality <= 0.7) return 1_000_000
  return 2_000_000
}

// ---- main render function ----

export function renderFlame(
  flame: FlameDescriptor,
  options: RenderOptions,
  onProgress?: (progress: number) => void,
): RenderResult {
  const { width, height, quality, seed, skipIters = 20 } = options
  const cam = defaultCamera(width, height)
  const totalPoints = qualityToPointCount(quality)

  // Initialize buckets: 4 floats per pixel (count, colorA, colorB, padding)
  const stride = 4
  const buckets = new Float64Array(width * height * stride)

  // Normalize transform weights to probabilities
  const totalWeight = flame.transforms.reduce((s, t) => s + t.weight, 0) || 1
  const transforms = flame.transforms.map((t, i) => ({
    ...t,
    probability: t.weight / totalWeight,
    cumulativeProb: 0,
  }))

  // Build cumulative probability array for fast random selection
  let cumProb = 0
  for (const t of transforms) {
    cumProb += t.probability
    t.cumulativeProb = cumProb
  }

  const pointInitFn =
    POINT_INIT_MODES['pointInitCircle']!

  // Process points in batches for progress reporting
  const batchSize = 100_000
  let processed = 0
  let batchIndex = 0

  while (processed < totalPoints) {
    const batch = Math.min(batchSize, totalPoints - processed)
    const batchRng = new Xoroshiro64(hashString(`${seed}-batch-${batchIndex}`))

    for (let i = 0; i < batch; i++) {
      const pointRng = new Xoroshiro64(hashString(`${seed}-point-${processed + i}`))

      // Point initialization
      let pos = pointInitFn(pointRng)
      let color: [number, number] = [0, 0]

      // Warm-up iterations (skipIters)
      for (let iter = 0; iter < skipIters; iter++) {
        const t = selectTransform(transforms, pointRng.next())
        pos = applyTransform(pos, t.variations, t.preAffine, t.postAffine, pointRng)
      }

      // Actual iteration
      const t = selectTransform(transforms, batchRng.next())
      pos = applyTransform(pos, t.variations, t.preAffine, t.postAffine, batchRng)
      color = blendColor(color, t.color, t.colorSpeed)

      // Camera projection
      const screen = worldToScreen(pos[0], pos[1], cam)

      // Bounds check
      const px = floor(screen[0])
      const py = floor(screen[1])
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * stride
        buckets[idx] += BUCKET_FIXED_POINT_MULTIPLIER
        buckets[idx + 1] += color[0] * BUCKET_FIXED_POINT_MULTIPLIER
        buckets[idx + 2] += color[1] * BUCKET_FIXED_POINT_MULTIPLIER
      }
    }

    processed += batch
    batchIndex++

    if (onProgress) {
      onProgress(processed / totalPoints)
    }
  }

  return { buckets, width, height, totalPoints }
}

function selectTransform(
  transforms: (FlameTransform & { cumulativeProb: number })[],
  rand: number,
): FlameTransform {
  for (const t of transforms) {
    if (rand < t.cumulativeProb) return t
  }
  return transforms[transforms.length - 1]!
}

function blendColor(
  current: [number, number],
  target: [number, number],
  speed: number,
): [number, number] {
  return [
    current[0] + (target[0] - current[0]) * speed,
    current[1] + (target[1] - current[1]) * speed,
  ]
}
