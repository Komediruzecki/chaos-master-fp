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
})
