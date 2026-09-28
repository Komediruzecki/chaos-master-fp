// Synthetic audio for the analyzer tests: a stand-in for a decoded buffer,
// repeatable noise and click tracks. No audio file and no AudioContext, so
// every run hears exactly the same signal.
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
): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.round(seconds * TEST_SAMPLE_RATE))
  const next = noise(7)
  const length = Math.round(0.01 * TEST_SAMPLE_RATE)
  times.forEach((time, c) => {
    const start = Math.round(time * TEST_SAMPLE_RATE)
    for (let i = 0; i < length; i++) {
      samples[start + i] = amplitudes[c]! * next() * (1 - i / length)
    }
  })
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
