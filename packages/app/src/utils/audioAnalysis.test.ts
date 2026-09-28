// The file analyzer: what a decoded track reads as, frame by frame, on
// synthetic signals (audioAnalysis.testUtils.ts).
import { describe, expect, it } from 'vitest'
import { createAudioAnalyzer } from './audioAnalysis'
import { audioBuffer, clicks, framesWhere, TEST_SAMPLE_RATE, } from './audioAnalysis.testUtils'

/** A 100 Hz tone that swells from -60 dB to -20 dB over two seconds. */
function swellingTone(): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(2 * TEST_SAMPLE_RATE)
  for (let i = 0; i < samples.length; i++) {
    const t = i / TEST_SAMPLE_RATE
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
    expect(framesWhere(analyzer, (frame) => frame.isBeat)).toEqual([
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
    expect(framesWhere(analyzer, (frame) => frame.isBeat)).toEqual([60])
  })

  it.each([
    [30, 0],
    [60, 0.017],
  ])(
    'finds an onset at every click of a 120 BPM click track at %i fps, %s s off the frame grid, and none in silence',
    async (fps, offset) => {
      // 1 s of silence, sixteen clicks every 0.5 s, then 2 s of silence.
      const times = Array.from({ length: 16 }, (_, c) => 1 + offset + 0.5 * c)
      const analyzer = await createAudioAnalyzer(
        audioBuffer(
          clicks(
            11,
            times,
            times.map(() => 0.5),
          ),
        ),
        fps,
      )
      expect(framesWhere(analyzer, (frame) => frame.onsetStrength > 0)).toEqual(
        times.map((time) => Math.floor(time * fps)),
      )
    },
  )
})
