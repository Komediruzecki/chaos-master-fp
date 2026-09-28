// Synthetic audio for the analyzer tests: a stand-in for a decoded buffer,
// repeatable noise, click tracks and a small band. No audio file and no
// AudioContext, so every run hears exactly the same signal.
import type { FrameData } from './audioMapping'

export const TEST_SAMPLE_RATE = 44100

/** A mono AudioBuffer over `samples`, shaped as decodeAudioData returns one. */
export function audioBuffer(
  samples: Float32Array<ArrayBuffer>,
  sampleRate = TEST_SAMPLE_RATE,
): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  }
}

/** A repeatable pseudo-random sequence in [-1, 1). */
export function noise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state / 0x100000000) * 2 - 1
  }
}

/** Silence with a 10 ms burst of decaying noise at each of `times` (seconds),
 *  each as loud as the matching entry of `amplitudes`. */
export function clicks(
  seconds: number,
  times: readonly number[],
  amplitudes: readonly number[],
  sampleRate = TEST_SAMPLE_RATE,
): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  const next = noise(7)
  const length = Math.round(0.01 * sampleRate)
  times.forEach((time, c) => {
    const start = Math.round(time * sampleRate)
    for (let i = 0; i < length; i++) {
      samples[start + i] = amplitudes[c]! * next() * (1 - i / length)
    }
  })
  return samples
}

/** White noise over all of `samples` added in place, at an RMS of `rmsDb`
 *  dB under full scale: a quiet room, a hiss. */
export function addNoise(
  samples: Float32Array<ArrayBuffer>,
  rmsDb: number,
  seed = 5,
): Float32Array<ArrayBuffer> {
  const next = noise(seed)
  // Uniform noise on [-1, 1) has an RMS of 1 / sqrt(3).
  const gain = 10 ** (rmsDb / 20) * Math.sqrt(3)
  for (let i = 0; i < samples.length; i++) samples[i]! += gain * next()
  return samples
}

/**
 * A small band at 120 BPM, about -20 dB RMS, added to `samples` in place from
 * `from` to `to` seconds: a kick on every beat, a snare on two and four, hats
 * on the eighths, a plucked bass note to a bar and a pad that swells over
 * eight seconds, so every band moves.
 */
export function addBand(
  samples: Float32Array<ArrayBuffer>,
  from: number,
  to: number,
  sampleRate = TEST_SAMPLE_RATE,
): Float32Array<ArrayBuffer> {
  const next = noise(3)
  const notes = [55, 65.4, 73.4, 49]
  let previousNoise = 0
  const end = Math.min(samples.length, Math.round(to * sampleRate))
  for (let i = Math.round(from * sampleRate); i < end; i++) {
    const t = i / sampleRate - from
    const inBeat = t % 0.5
    const kick = Math.sin(
      2 * Math.PI * (55 + 60 * Math.exp(-inBeat / 0.02)) * inBeat,
    )
    const hiss = next()
    const snare =
      Math.floor(t / 0.5) % 2 === 1 ? Math.exp(-inBeat / 0.05) * hiss : 0
    const hat = Math.exp(-(t % 0.25) / 0.015) * (hiss - previousNoise)
    previousNoise = hiss
    const note = notes[Math.floor(t / 2) % notes.length]!
    const bass = Math.exp(-(t % 2) / 0.6) * (2 * ((note * t) % 1) - 1)
    const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 8)
    const pad = [220, 277.2, 329.6, 440].reduce(
      (sum, f, k) => sum + (k === 3 ? 0.5 : 1) * Math.sin(2 * Math.PI * f * t),
      0,
    )
    samples[i]! +=
      0.5 * Math.exp(-inBeat / 0.08) * kick +
      0.25 * snare +
      0.06 * hat +
      0.12 * bass +
      0.04 * swell * pad
  }
  return samples
}

/** The frames of a file analyzer whose data passes `test`. */
export function framesWhere(
  analyzer: {
    totalFrames: number
    getFrameData(frame: number): FrameData & { isBeat: boolean }
  },
  test: (frame: FrameData & { isBeat: boolean }) => boolean,
): number[] {
  return Array.from({ length: analyzer.totalFrames }, (_, i) => i).filter((i) =>
    test(analyzer.getFrameData(i)),
  )
}
