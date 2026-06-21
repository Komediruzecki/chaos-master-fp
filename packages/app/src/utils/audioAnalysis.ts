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

function getFftBands(
  fftData: Float32Array,
  sampleRate: number,
): { bands: number[]; centroid: number; flatness: number } {
  const binCount = fftData.length
  const nyquist = sampleRate / 2
  const bands = new Array(BAND_COUNT).fill(0)
  const bandBinCounts = new Array(BAND_COUNT).fill(0)

  for (let i = 0; i < binCount; i++) {
    const freq = (i / binCount) * nyquist
    const mag = fftData[i]!
    for (let b = 0; b < BAND_COUNT; b++) {
      const [low, high] = BAND_RANGES[b]!
      if (freq >= low && freq < high) {
        bands[b] += mag
        bandBinCounts[b]!++
      }
    }
  }

  for (let b = 0; b < BAND_COUNT; b++) {
    if (bandBinCounts[b]! > 0) {
      bands[b] = bands[b]! / bandBinCounts[b]!
    }
  }

  // Spectral centroid
  let weightedSum = 0
  let totalMag = 0
  for (let i = 0; i < binCount; i++) {
    const freq = (i / binCount) * nyquist
    const mag = fftData[i]!
    weightedSum += freq * mag
    totalMag += mag
  }
  const centroid = totalMag > 0 ? weightedSum / totalMag : 0

  // Spectral flatness (geometric mean / arithmetic mean)
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

export function createAudioAnalyzer(
  audioBuffer: AudioBuffer,
  targetFps: number,
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

  // Cache per-frame FFT data
  const frameCache = new Map<number, FrameData>()

  function getFrameData(frameIndex: number): FrameData & { isBeat: boolean } {
    const clampedIndex = Math.max(0, Math.min(frameIndex, totalFrames - 1))

    let frame = frameCache.get(clampedIndex)
    if (!frame) {
      const start = clampedIndex * samplesPerFrame
      const end = Math.min(start + samplesPerFrame, length)
      const slice = monoData.slice(start, end)

      // Zero-pad to fftSize
      const padded = new Float32Array(fftSize)
      padded.set(slice)

      // Simple DFT magnitude spectrum (no OfflineAudioContext needed for basic analysis)
      const { bands, centroid, flatness } = fftMagnitudeSpectrum(
        padded,
        sampleRate,
      )
      const rms = computeRms(slice)

      frame = { bands, rms, centroid, flatness }
      frameCache.set(clampedIndex, frame)
    }

    return { ...frame, isBeat: false }
  }

  // Compute beats after all frames are analyzed
  const beatFrames = computeBeats(totalFrames, (i) => {
    const fd = getFrameData(i)
    return { bands: fd.bands, rms: fd.rms }
  })

  return {
    getFrameData(frameIndex: number) {
      const data = getFrameData(frameIndex)
      return { ...data, isBeat: beatFrames.has(frameIndex) }
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

function fftMagnitudeSpectrum(
  data: Float32Array,
  sampleRate: number,
): { bands: number[]; centroid: number; flatness: number } {
  // Use an OfflineAudioContext for accurate FFT analysis
  // Falls back to a simple DFT for basic magnitude spectrum if needed
  const fftSize = data.length
  const real = new Float32Array(fftSize)
  real.set(data)

  // Simple DFT (not FFT — fine for analysis, not real-time)
  const halfSize = fftSize / 2
  const mags = new Float32Array(halfSize)

  // Only compute magnitudes for production use
  for (let k = 0; k < halfSize; k++) {
    let re = 0
    let im = 0
    const angleStep = (-2 * Math.PI * k) / fftSize
    for (let n = 0; n < fftSize; n++) {
      const angle = angleStep * n
      const val = real[n] ?? 0
      re += val * Math.cos(angle)
      im += val * Math.sin(angle)
    }
    mags[k] = Math.sqrt(re * re + im * im) / fftSize
  }

  return getFftBands(mags, sampleRate)
}

function computeBeats(
  totalFrames: number,
  getData: (i: number) => { bands: number[]; rms: number },
): Set<number> {
  const beats = new Set<number>()
  if (totalFrames < 2) return beats

  // Compute spectral flux (change in magnitude between consecutive frames)
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

  // Adaptive threshold: mean + 1.5 * stddev
  const mean = flux.reduce((a, b) => a + b, 0) / flux.length
  const variance = flux.reduce((a, b) => a + (b - mean) ** 2, 0) / flux.length
  const threshold = mean + 1.5 * Math.sqrt(variance)

  // Detect onsets with ~100ms minimum gap
  const minGapFrames = Math.max(1, Math.floor(0.1 * 30)) // ~3 frames at 30fps
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

export function detectBeats(frames: FrameData[]): Set<number> {
  return computeBeats(frames.length, (i) => {
    const fd = frames[i]!
    return { bands: fd.bands, rms: fd.rms }
  })
}
