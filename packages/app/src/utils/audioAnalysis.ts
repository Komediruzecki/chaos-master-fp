// Audio analysis: FFT bands, beats and onsets for a decoded file and for the
// live microphone. The mapping stage (audioMapping.ts) and the flame writers
// (audioTargets.ts) are re-exported from here, so importers keep one path.

import { createBandPeakNormalizer, createLiveBeatDetector, createLiveOnsetDetector, detectBeatFrames, detectOnsets, hannWindow, logSpectralFlux, normalizeTrackBands, } from '@chaos-master/core'
import type { FrameData } from './audioMapping'

export * from './audioMapping'
export * from './audioTargets'

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

export type AudioAnalyzer = {
  getFrameData(frameIndex: number): FrameData & { isBeat: boolean }
  totalFrames: number
  duration: number
  sampleRate: number
}

export type LiveAudioAnalyzer = {
  getFrameData(): FrameData & { isBeat: boolean }
  sampleRate: number
  dispose(): void
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

/**
 * The magnitude spectrum of the `window.length` samples of `samples` from
 * index `from`, Hann-windowed. Samples before the start or past the end read
 * 0. Magnitudes are |X| / N, the scale the bands have always had.
 */
function frameSpectrum(
  samples: Float32Array,
  from: number,
  window: Float32Array,
): Float32Array {
  const size = window.length
  const real = new Float64Array(size)
  const imag = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    const at = from + i
    if (at >= 0 && at < samples.length) real[i] = samples[at]! * window[i]!
  }
  fft(real, imag)
  const mags = new Float32Array(size / 2)
  for (let k = 0; k < size / 2; k++) {
    mags[k] = Math.sqrt(real[k]! * real[k]! + imag[k]! * imag[k]!) / size
  }
  return mags
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

/** Decode encoded audio bytes -- a fetched or uploaded file -- into a buffer. */
export async function decodeAudioBytes(
  bytes: ArrayBuffer,
): Promise<AudioBuffer> {
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(bytes)
  } finally {
    void ctx.close()
  }
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  return decodeAudioBytes(await file.arrayBuffer())
}

// --- Beat detection ---

/** Beats from the rise of the raw bands frame to frame (band flux), picked
 *  against the music around each frame at the analyzer's real frame rate. */
function computeBeats(
  totalFrames: number,
  getData: (i: number) => { bands: number[]; rms: number },
  fps: number,
): Set<number> {
  const flux = new Float64Array(totalFrames)
  for (let i = 1; i < totalFrames; i++) {
    const data = getData(i)
    const prev = getData(i - 1)
    let diff = 0
    for (let b = 0; b < BAND_COUNT; b++) {
      const d = (data.bands[b] ?? 0) - (prev.bands[b] ?? 0)
      if (d > 0) diff += d
    }
    flux[i] = diff
  }
  return detectBeatFrames(flux, fps)
}

// --- Public API ---

export async function createAudioAnalyzer(
  audioBuffer: AudioBuffer,
  targetFps: number,
  onProgress?: (current: number, total: number) => void,
): Promise<AudioAnalyzer> {
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
  const window = hannWindow(fftSize)
  // The real frame rate: a frame is a whole number of samples, so 44.1 kHz at
  // 24 fps runs at 24.006 frames a second, not 24.
  const fps = sampleRate / samplesPerFrame

  onProgress?.(0, totalFrames)

  // Every frame, in order, up front: about a second for a three-minute song.
  // A clip shorter than one frame still gets its one frame.
  const frames: FrameData[] = []
  const flux = new Float64Array(totalFrames)
  let previousMags: Float32Array | undefined
  const BATCH_SIZE = 50
  for (let i = 0; i < Math.max(1, totalFrames); i++) {
    const start = i * samplesPerFrame
    const slice = monoData.subarray(
      start,
      Math.min(start + samplesPerFrame, length),
    )
    // The spectrum of the fftSize samples centred on the frame.
    const from = start + Math.floor(samplesPerFrame / 2) - fftSize / 2
    const mags = frameSpectrum(monoData, from, window)
    const { bands, centroid, flatness } = getFftBands(mags, sampleRate)
    // The raw level, never normalised like the bands below: wirings made
    // before band levels, the research examples among them, set their rms
    // ranges by it.
    const rms = computeRms(slice)
    frames.push({ bands, rms, centroid, flatness, onsetStrength: 0 })
    if (previousMags && i < totalFrames) {
      flux[i] = logSpectralFlux(previousMags, mags)
    }
    previousMags = mags
    onProgress?.(i + 1, totalFrames)
    if (i % BATCH_SIZE === 0 && i > 0) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  const beatFrames = computeBeats(totalFrames, (i) => frames[i]!, fps)
  const onsets = detectOnsets(flux, fps)
  // Bands leave as levels on [0, 1] against the range each covers in this
  // track: a raw band is about 0.001 on real music. The beats above read the
  // raw magnitudes first.
  const levels = normalizeTrackBands(frames.map((frame) => frame.bands))
  frames.forEach((frame, i) => {
    frame.bands = levels[i]!
    frame.onsetStrength = onsets[i] ?? 0
  })

  return {
    getFrameData(frameIndex: number) {
      const clampedIndex = Math.max(0, Math.min(frameIndex, totalFrames - 1))
      return { ...frames[clampedIndex]!, isBeat: beatFrames.has(clampedIndex) }
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

export function detectBeats(frames: FrameData[], fps: number): Set<number> {
  return computeBeats(
    frames.length,
    (i) => {
      const fd = frames[i]!
      return { bands: fd.bands, rms: fd.rms }
    },
    fps,
  )
}

// --- Live microphone analyzer ---

/** The microphone as music, not as a call: echo cancellation, noise
 *  suppression and automatic gain would reshape what the flame hears. */
export const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
} satisfies MediaStreamConstraints

/** The least audio time between two analyses of the live input. Reads this
 *  close hold the same samples, give or take one 128-sample render quantum
 *  (3 ms at 44.1 kHz), so callers polling in one frame, a panel's meters and
 *  the render loop, share one analysis, and it advances once. */
export const LIVE_HOP_SECONDS = 0.005

/** How long a live beat or onset stays up once found, on the audio clock. A
 *  caller polling at least every 50 ms sees it, whichever poll found it, and
 *  an envelope takes in a pulse of about the same length at 30 and 60 Hz (67
 *  and 50 ms) instead of one poll's (33 and 17 ms). */
export const LIVE_EVENT_HOLD_SECONDS = 0.05

/** Turns the newest samples of a live input into frames. */
export type LiveFrameProcessor = {
  /** The frame for `timeDomain`, the newest `fftSize` samples, heard at
   *  `timeSeconds` on the audio clock. */
  process(
    timeDomain: Float32Array,
    timeSeconds: number,
  ): FrameData & { isBeat: boolean }
}

/**
 * The live analysis, apart from the browser so it can run on any signal: the
 * file analyzer's spectrum (Hann-windowed), bands against a peak that follows
 * each band, beats and onsets picked from the past only, and every window and
 * gap in seconds on the audio clock rather than in calls.
 */
export function createLiveFrameProcessor(
  sampleRate: number,
  fftSize: number,
): LiveFrameProcessor {
  const window = hannWindow(fftSize)
  const bandLevels = createBandPeakNormalizer()
  const onsets = createLiveOnsetDetector()
  const beats = createLiveBeatDetector()
  let previousMags: Float32Array | undefined
  let previousBands: number[] | undefined
  let lastTime: number | undefined
  let last: FrameData & { isBeat: boolean } = {
    bands: new Array<number>(BAND_COUNT).fill(0),
    rms: 0,
    centroid: 0,
    flatness: 0,
    onsetStrength: 0,
    isBeat: false,
  }
  let onsetStrength = 0
  let onsetUntil = -Infinity
  let beatUntil = -Infinity

  return {
    process(timeDomain, timeSeconds) {
      if (lastTime !== undefined && timeSeconds - lastTime < LIVE_HOP_SECONDS) {
        return { ...last }
      }
      const dt = lastTime === undefined ? 0 : timeSeconds - lastTime
      lastTime = timeSeconds

      const mags = frameSpectrum(timeDomain, 0, window)
      const { bands, centroid, flatness } = getFftBands(mags, sampleRate)
      // Band flux and log flux against the last hop; the first hop has none.
      let bandFlux = 0
      if (previousBands) {
        for (let b = 0; b < BAND_COUNT; b++) {
          bandFlux += Math.max(0, bands[b]! - previousBands[b]!)
        }
      }
      const flux = previousMags ? logSpectralFlux(previousMags, mags) : 0
      previousMags = mags
      previousBands = bands

      const strength = onsets(timeSeconds, flux)
      if (strength > 0) {
        onsetStrength = strength
        onsetUntil = timeSeconds + LIVE_EVENT_HOLD_SECONDS
      }
      if (beats(timeSeconds, bandFlux)) {
        beatUntil = timeSeconds + LIVE_EVENT_HOLD_SECONDS
      }
      last = {
        bands: bandLevels.levels(bands, dt),
        // The raw level, as the file analyzer keeps it.
        rms: computeRms(timeDomain),
        centroid,
        flatness,
        onsetStrength: timeSeconds < onsetUntil ? onsetStrength : 0,
        isBeat: timeSeconds < beatUntil,
      }
      return { ...last }
    },
  }
}

/** Creates a real-time audio analyzer from the microphone. The browser's
 *  AnalyserNode hands over the newest samples; createLiveFrameProcessor turns
 *  them into FrameData the file analyzer's consumers read unchanged. */
export async function createLiveAnalyzer(
  targetFps: number = 30,
): Promise<LiveAudioAnalyzer> {
  const stream =
    await globalThis.navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
  const audioCtx = new AudioContext()
  const sampleRate = audioCtx.sampleRate

  const source = audioCtx.createMediaStreamSource(stream)
  const analyser = audioCtx.createAnalyser()

  const samplesPerFrame = Math.floor(sampleRate / targetFps)
  const fftSize = Math.max(256, nextPowerOfTwo(samplesPerFrame))
  analyser.fftSize = fftSize
  analyser.smoothingTimeConstant = 0.3

  source.connect(analyser)

  const processor = createLiveFrameProcessor(sampleRate, fftSize)
  const timeData = new Float32Array(fftSize)

  return {
    getFrameData() {
      analyser.getFloatTimeDomainData(timeData)
      return processor.process(timeData, audioCtx.currentTime)
    },
    sampleRate,
    dispose() {
      stream.getTracks().forEach((t) => {
        t.stop()
      })
      source.disconnect()
      analyser.disconnect()
      void audioCtx.close()
    },
  }
}
