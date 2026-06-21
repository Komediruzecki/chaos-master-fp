const BAND_RANGES: [number, number][] = [
  [20, 60], // sub-bass
  [60, 250], // bass
  [250, 500], // low-mid
  [500, 2000], // mid
  [2000, 4000], // hi-mid
  [4000, 6000], // presence
  [6000, 20000], // brilliance
  [20, 20000], // full spectrum
]

const BAND_COUNT = BAND_RANGES.length

export type FrameData = {
  bands: number[]
  rms: number
  centroid: number
  flatness: number
}

export type AudioAnalyzer = {
  getFrameData(frameIndex: number): FrameData & { isBeat: boolean }
  totalFrames: number
  duration: number
  sampleRate: number
}

// --- Radix-2 FFT (iterative, in-place) ---

function reverseBits(n: number, bits: number): number {
  let r = 0
  for (let i = 0; i < bits; i++) {
    r = (r << 1) | (n & 1)
    n >>= 1
  }
  return r
}

function fft(real: Float64Array, imag: Float64Array): void {
  const N = real.length
  const bits = Math.log2(N)
  if ((bits | 0) !== bits) return // N must be power of 2

  // Bit-reversal permutation
  for (let i = 0; i < N; i++) {
    const j = reverseBits(i, bits)
    if (j > i) {
      ;[real[i], real[j]] = [real[j]!, real[i]!]
      ;[imag[i], imag[j]] = [imag[j]!, imag[i]!]
    }
  }

  // Cooley-Tukey
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1
    const angle = (-2 * Math.PI) / size
    for (let block = 0; block < N; block += size) {
      for (let k = 0; k < half; k++) {
        const cos = Math.cos(angle * k)
        const sin = Math.sin(angle * k)
        const ri = block + k
        const rj = block + k + half
        const tr = real[rj]! * cos - imag[rj]! * sin
        const ti = real[rj]! * sin + imag[rj]! * cos
        real[rj] = real[ri]! - tr
        imag[rj] = imag[ri]! - ti
        real[ri] = real[ri]! + tr
        imag[ri] = imag[ri]! + ti
      }
    }
  }
}

function fftMagnitudeSpectrum(
  data: Float32Array,
  _sampleRate: number,
): { bands: number[]; centroid: number; flatness: number } {
  const N = data.length
  const real = new Float64Array(N)
  for (let i = 0; i < N; i++) real[i] = data[i] ?? 0
  const imag = new Float64Array(N)

  fft(real, imag)

  const halfSize = N / 2
  const mags = new Float32Array(halfSize)
  for (let k = 0; k < halfSize; k++) {
    mags[k] = Math.sqrt(real[k]! * real[k]! + imag[k]! * imag[k]!) / N
  }

  return getFftBands(mags, _sampleRate)
}

function getFftBands(
  fftData: Float32Array,
  sampleRate: number,
): { bands: number[]; centroid: number; flatness: number } {
  const binCount = fftData.length
  const nyquist = sampleRate / 2
  const bands = new Array(BAND_COUNT).fill(0) as number[]
  const bandBinCounts = new Array(BAND_COUNT).fill(0) as number[]

  for (let i = 0; i < binCount; i++) {
    const freq = (i / binCount) * nyquist
    const mag = fftData[i]!
    for (let b = 0; b < BAND_COUNT; b++) {
      const [low, high] = BAND_RANGES[b]!
      if (freq >= low && freq < high) {
        bands[b] = (bands[b] ?? 0) + mag
        bandBinCounts[b]!++
      }
    }
  }

  for (let b = 0; b < BAND_COUNT; b++) {
    if (bandBinCounts[b]! > 0) {
      bands[b] = bands[b]! / bandBinCounts[b]!
    }
  }

  let weightedSum = 0
  let totalMag = 0
  for (let i = 0; i < binCount; i++) {
    const freq = (i / binCount) * nyquist
    const mag = fftData[i]!
    weightedSum += freq * mag
    totalMag += mag
  }
  const centroid = totalMag > 0 ? weightedSum / totalMag : 0

  let logSum = 0
  let linSum = 0
  let nonZeroCount = 0
  for (let i = 0; i < binCount; i++) {
    const mag = fftData[i]!
    if (mag > 1e-10) {
      logSum += Math.log(mag)
      linSum += mag
      nonZeroCount++
    }
  }
  const flatness =
    nonZeroCount > 1 && linSum > 0
      ? Math.exp(logSum / nonZeroCount) / (linSum / nonZeroCount)
      : 0

  return { bands, centroid, flatness }
}

function computeRms(data: Float32Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    sum += data[i]! * data[i]!
  }
  return Math.sqrt(sum / data.length)
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = new AudioContext()
  try {
    const arrayBuffer = await file.arrayBuffer()
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    void ctx.close()
  }
}

// --- Beat detection ---

function computeBeats(
  totalFrames: number,
  getData: (i: number) => { bands: number[]; rms: number },
): Set<number> {
  const beats = new Set<number>()
  if (totalFrames < 2) return beats

  const flux: number[] = []
  for (let i = 0; i < totalFrames; i++) {
    const data = getData(i)
    if (i === 0) {
      flux.push(0)
    } else {
      const prev = getData(i - 1)
      let diff = 0
      for (let b = 0; b < BAND_COUNT; b++) {
        const d = (data.bands[b] ?? 0) - (prev.bands[b] ?? 0)
        if (d > 0) diff += d
      }
      flux.push(diff)
    }
  }

  const mean = flux.reduce((a, b) => a + b, 0) / flux.length
  const variance = flux.reduce((a, b) => a + (b - mean) ** 2, 0) / flux.length
  const threshold = mean + 1.5 * Math.sqrt(variance)

  const minGapFrames = Math.max(1, Math.floor(0.1 * 30))
  let lastBeatFrame = -minGapFrames

  for (let i = 1; i < flux.length; i++) {
    if (
      flux[i]! > threshold &&
      flux[i]! > flux[i - 1]! &&
      i - lastBeatFrame >= minGapFrames
    ) {
      beats.add(i)
      lastBeatFrame = i
    }
  }

  return beats
}

// --- Public API ---

export function createAudioAnalyzer(
  audioBuffer: AudioBuffer,
  targetFps: number,
  onProgress?: (current: number, total: number) => void,
): AudioAnalyzer {
  const { sampleRate, length, duration, numberOfChannels } = audioBuffer

  // Mix down to mono
  const monoData = new Float32Array(length)
  if (numberOfChannels === 1) {
    monoData.set(audioBuffer.getChannelData(0))
  } else {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        monoData[i] = (monoData[i] ?? 0) + channelData[i]!
      }
    }
    for (let i = 0; i < length; i++) {
      monoData[i] = monoData[i]! / numberOfChannels
    }
  }

  const samplesPerFrame = Math.floor(sampleRate / targetFps)
  const totalFrames = Math.floor(length / samplesPerFrame)
  const fftSize = Math.max(256, nextPowerOfTwo(samplesPerFrame))

  onProgress?.(0, totalFrames)

  // Analyze every frame up front — with a proper FFT this is ~1s for a 3min song.
  const frameCache = new Map<number, FrameData>()

  function getOrComputeFrame(i: number): FrameData {
    let frame = frameCache.get(i)
    if (frame) return frame

    const start = i * samplesPerFrame
    const end = Math.min(start + samplesPerFrame, length)
    const slice = monoData.slice(start, end)
    const padded = new Float32Array(fftSize)
    padded.set(slice)

    const { bands, centroid, flatness } = fftMagnitudeSpectrum(
      padded,
      sampleRate,
    )
    const rms = computeRms(slice)

    frame = { bands, rms, centroid, flatness }
    frameCache.set(i, frame)
    onProgress?.(i + 1, totalFrames)
    return frame
  }

  // Pre-compute all frames
  for (let i = 0; i < totalFrames; i++) {
    getOrComputeFrame(i)
  }

  const beatFrames = computeBeats(totalFrames, getOrComputeFrame)

  return {
    getFrameData(frameIndex: number) {
      const clampedIndex = Math.max(0, Math.min(frameIndex, totalFrames - 1))
      const data = getOrComputeFrame(clampedIndex)
      return { ...data, isBeat: beatFrames.has(clampedIndex) }
    },
    totalFrames,
    duration,
    sampleRate,
  }
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

export function detectBeats(frames: FrameData[]): Set<number> {
  return computeBeats(frames.length, (i) => {
    const fd = frames[i]!
    return { bands: fd.bands, rms: fd.rms }
  })
}

// --- Audio→Flame mapping (shared between live preview and export) ---

export type AudioMappingEntry = {
  audioFeature:
    | 'subBass'
    | 'bass'
    | 'lowMid'
    | 'mid'
    | 'hiMid'
    | 'presence'
    | 'brilliance'
    | 'fullSpectrum'
    | 'rms'
    | 'centroid'
    | 'flatness'
    | 'beat'
  flameParam:
    | 'vibrancy'
    | 'exposure'
    | 'palettePhase'
    | 'paletteSpeed'
    | 'contrast'
    | 'gamma'
    | 'highlightPower'
    | 'lightPower'
    | 'depthColorPower'
    | 'zoom'
    | 'skipIters'
  sensitivity: number
  range: [number, number]
}

function getAudioFeatureNormalized(
  frameData: FrameData & { isBeat: boolean },
  feature: AudioMappingEntry['audioFeature'],
): number {
  if (feature === 'beat') return frameData.isBeat ? 1 : 0
  if (feature === 'rms') return Math.min(1, frameData.rms)
  if (feature === 'centroid') return Math.min(1, frameData.centroid / 20000)
  if (feature === 'flatness') return frameData.flatness
  const bandMap: Record<string, number> = {
    subBass: 0,
    bass: 1,
    lowMid: 2,
    mid: 3,
    hiMid: 4,
    presence: 5,
    brilliance: 6,
    fullSpectrum: 7,
  }
  const idx = bandMap[feature]
  if (idx !== undefined) return Math.min(1, frameData.bands[idx]!)
  return 0
}

function mappingToVal(
  normalizedValue: number,
  mapping: AudioMappingEntry,
): number {
  const [lo, hi] = mapping.range
  return lo + normalizedValue * mapping.sensitivity * (hi - lo)
}

/** Mutates `flame.renderSettings` in place from audio analysis data. */
export function applyAudioMappingsToFlame(
  flame: { renderSettings?: Record<string, unknown> },
  frameData: FrameData & { isBeat: boolean },
  mappings: AudioMappingEntry[],
): void {
  if (mappings.length === 0) return
  const rs = (flame.renderSettings ?? {}) as Record<string, unknown>
  const camera = (rs.camera as Record<string, unknown> | undefined) ?? {}
  for (const mapping of mappings) {
    const raw = getAudioFeatureNormalized(frameData, mapping.audioFeature)
    const clamped = Math.max(0, Math.min(1, raw))
    const val = mappingToVal(clamped, mapping)
    if (mapping.flameParam === 'zoom') {
      ;(camera as Record<string, number>).zoom = val
    } else {
      ;(rs as Record<string, number>)[mapping.flameParam] = val
    }
  }
  ;(rs as Record<string, unknown>).camera = camera
  flame.renderSettings = rs
}
