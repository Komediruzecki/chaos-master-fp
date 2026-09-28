// The file analyzer: what a decoded track reads as, frame by frame, on
// synthetic signals built here (no audio file, no AudioContext).
import { describe, expect, it } from 'vitest'
import { createAudioAnalyzer } from './audioAnalysis'

const SAMPLE_RATE = 44100

/** A mono AudioBuffer over `samples`, shaped as decodeAudioData returns one. */
function audioBuffer(samples: Float32Array<ArrayBuffer>): AudioBuffer {
  return {
    sampleRate: SAMPLE_RATE,
    length: samples.length,
    duration: samples.length / SAMPLE_RATE,
    numberOfChannels: 1,
    getChannelData: () => samples,
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  }
}

/** A 100 Hz tone that swells from -60 dB to -20 dB over two seconds. */
function swellingTone(): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(2 * SAMPLE_RATE)
  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE
    samples[i] = 10 ** ((-60 + 20 * t) / 20) * Math.sin(2 * Math.PI * 100 * t)
  }
  return samples
}

/** A repeatable pseudo-random sequence in [-1, 1), so a test's noise is the
 *  same on every run. */
function noise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state / 0x100000000) * 2 - 1
  }
}

/** Silence with a 10 ms burst of decaying noise at each of `times` (seconds),
 *  each as loud as the matching entry of `amplitudes`. */
function clicks(
  seconds: number,
  times: readonly number[],
  amplitudes: readonly number[],
): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  const next = noise(7)
  const length = Math.round(0.01 * SAMPLE_RATE)
  times.forEach((time, c) => {
    const start = Math.round(time * SAMPLE_RATE)
    for (let i = 0; i < length; i++) {
      samples[start + i] = amplitudes[c]! * next() * (1 - i / length)
    }
  })
  return samples
}

/** The frames an analyzer marks as beats. */
function beatFrames(analyzer: {
  totalFrames: number
  getFrameData(frame: number): { isBeat: boolean }
}): number[] {
  return Array.from({ length: analyzer.totalFrames }, (_, i) => i).filter(
    (i) => analyzer.getFrameData(i).isBeat,
  )
}

describe('the file analyzer', () => {
  it('reads a band from 0 to 1 over the range it covers in its track', async () => {
    const analyzer = await createAudioAnalyzer(audioBuffer(swellingTone()), 30)
    const bass = (frame: number) => analyzer.getFrameData(frame).bands[1]
    expect(analyzer.totalFrames).toBe(60)
    expect(bass(0)).toBe(0)
    expect(bass(59)).toBe(1)
  })

  it('keeps rms as the raw level of the frame', async () => {
    const analyzer = await createAudioAnalyzer(audioBuffer(swellingTone()), 30)
    // The last frame, 1.967 s to 2 s, holds the tone at about -20.3 dB: an
    // amplitude of 0.097, so an RMS of 0.097 / sqrt 2.
    expect(analyzer.getFrameData(59).rms).toBeCloseTo(0.0687, 4)
  })

  it('keeps the beats of a quiet passage that follows a loud one', async () => {
    // 120 BPM: twelve clicks, then twelve more 26 dB quieter.
    const times = Array.from({ length: 24 }, (_, c) => 0.5 + 0.5 * c)
    const amplitudes = times.map((_, c) => (c < 12 ? 0.8 : 0.04))
    const analyzer = await createAudioAnalyzer(
      audioBuffer(clicks(13, times, amplitudes)),
      30,
    )
    // All twelve loud clicks, and the quiet ones from 8.5 s on. The four quiet
    // clicks within 2 s of the loud ones sit under the threshold of a window
    // that still holds them; one threshold over the whole track found none.
    expect(beatFrames(analyzer)).toEqual([
      15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 255, 270, 285, 300,
      315, 330, 345, 360,
    ])
  })

  it('holds the minimum gap between beats at 0.1 s at 60 fps', async () => {
    // Two clicks 70 ms apart are one beat.
    const analyzer = await createAudioAnalyzer(
      audioBuffer(clicks(2, [1, 1.07], [0.8, 0.8])),
      60,
    )
    expect(beatFrames(analyzer)).toEqual([60])
  })
})
