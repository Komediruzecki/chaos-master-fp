// Pins export audio modulation: the live step replayed over every analyzer
// frame, each output frame reading the analyzer frame of its own time, from a
// fresh state, with sub-frames and backward seeks answered from the same
// sequence.
import { describe, expect, it } from 'vitest'
import { createAudioAnalyzer } from './audioAnalysis'
import { createAudioModulator } from './audioModulator'
import { createExportAudioModulation } from './exportAudioModulation'
import type { AudioMappingEntry, FrameData } from './audioMapping'

function frameAt(index: number): FrameData & { isBeat: boolean } {
  return {
    bands: [0, (index % 5) / 4, 0, 0, 0, 0, 0, 0],
    rms: (index % 7) / 6,
    centroid: 0,
    flatness: 0,
    onsetStrength: 0,
    isBeat: index % 10 === 0,
  }
}

// 48 kHz divides into 30 frames a second exactly: the analyzer runs at the
// export's own rate.
const source = { sampleRate: 48_000, totalFrames: 90, getFrameData: frameAt }

const mappings: AudioMappingEntry[] = [
  {
    audioFeature: 'rms',
    target: { kind: 'renderSetting', param: 'exposure' },
    sensitivity: 1,
    range: [0.5, 2],
    attackMs: 40,
    releaseMs: 220,
  },
  {
    audioFeature: 'bass',
    target: { kind: 'renderSetting', param: 'zoom' },
    sensitivity: 1,
    range: [1, 2],
    releaseMs: 300,
  },
  {
    audioFeature: 'beat',
    target: { kind: 'renderSetting', param: 'palettePhase' },
    sensitivity: 1,
    range: [0, 0.12],
    attackMs: 60,
    releaseMs: 900,
  },
]

const authored = {
  renderSettings: { exposure: 1, palettePhase: 0.5, camera: { zoom: 1.2 } },
}

describe('createExportAudioModulation', () => {
  it('matches a live modulator stepped over the same frames', () => {
    const exported = createExportAudioModulation(
      source,
      mappings,
      30,
      'standard',
    )
    const live = createAudioModulator('standard')
    for (let frame = 0; frame <= 60; frame++) {
      expect(exported.valuesAt(frame, authored)).toEqual(
        live.step(frameAt(frame), mappings, 1 / 30, authored).values,
      )
    }
  })

  it('applies the envelope, which the old export path skipped', () => {
    const quietThenLoud = {
      sampleRate: 48_000,
      totalFrames: 2,
      getFrameData: (index: number) => ({ ...frameAt(0), rms: index }),
    }
    const skipIters: AudioMappingEntry = {
      audioFeature: 'rms',
      target: { kind: 'renderSetting', param: 'skipIters' },
      sensitivity: 1,
      range: [0, 10],
      attackMs: 100,
    }
    const exported = createExportAudioModulation(
      quietThenLoud,
      [skipIters],
      30,
      'standard',
    )
    // A 100 ms attack at 1/30 s per frame moves a quarter of the way: 2.5,
    // where the export used to write the raw 10.
    expect(exported.valuesAt(1)[0]!.value).toBeCloseTo(2.5, 12)
  })

  it('answers a sub-frame from the frame it belongs to', () => {
    const exported = createExportAudioModulation(
      source,
      mappings,
      30,
      'standard',
    )
    const first = exported.valuesAt(4, authored)
    expect(exported.valuesAt(4, authored)).toBe(first)
  })

  it('replays from the start when asked for an earlier frame', () => {
    const exported = createExportAudioModulation(source, mappings, 30, 'calm')
    exported.valuesAt(20, authored)
    const fresh = createExportAudioModulation(source, mappings, 30, 'calm')
    expect(exported.valuesAt(5, authored)).toEqual(fresh.valuesAt(5, authored))
  })

  // The analyzer's frame is a whole number of samples, so it runs a little
  // faster than the export asked: 24.0065 frames a second for 24 at 44.1 kHz.
  // Read frame for frame, a five-minute export drifted up to 17 analyzer
  // frames, 0.3 s, ahead of the music.
  it.each([
    [24, 44_100],
    [55, 44_100],
    [54, 48_000],
  ])(
    "steps every analyzer frame up to the one at each output frame's time, at %i fps from %i Hz",
    (fps, sampleRate) => {
      const stepped: number[] = []
      const analyzer = {
        sampleRate,
        totalFrames: 1_000_000,
        getFrameData: (index: number) => {
          stepped.push(index)
          return frameAt(index)
        },
      }
      const exported = createExportAudioModulation(
        analyzer,
        mappings,
        fps,
        'standard',
      )
      const analyzerFrameSeconds = Math.floor(sampleRate / fps) / sampleRate
      let worst = 0
      for (let frame = 0; frame <= fps * 300; frame++) {
        exported.valuesAt(frame, authored)
        const heard = stepped.at(-1)! * analyzerFrameSeconds
        worst = Math.max(worst, Math.abs(heard - frame / fps))
      }
      expect(worst).toBeLessThan(analyzerFrameSeconds)
      expect(stepped).toEqual(stepped.map((_, index) => index))
    },
  )

  it("hears a real analyzer's music at the output frame of its time", async () => {
    // Two minutes at 44.1 kHz, silent until 110.25 s and a tone after it, as
    // the analyzer hears it at 55 fps.
    const sampleRate = 44_100
    const onset = 110.25
    const samples = new Float32Array(120 * sampleRate)
    for (let i = Math.round(onset * sampleRate); i < samples.length; i++) {
      samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)
    }
    const buffer = {
      sampleRate,
      length: samples.length,
      duration: samples.length / sampleRate,
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as unknown as AudioBuffer
    const analyzer = await createAudioAnalyzer(buffer, 55)
    const loudness: AudioMappingEntry = {
      audioFeature: 'rms',
      target: { kind: 'renderSetting', param: 'skipIters' },
      sensitivity: 1,
      range: [0, 50],
    }
    const exported = createExportAudioModulation(
      analyzer,
      [loudness],
      55,
      'standard',
    )
    let frame = 0
    while (exported.valuesAt(frame)[0]!.value === 0 && frame < 55 * 120) {
      frame++
    }
    // The first output frame that hears the tone sits within one output
    // frame and one analyzer frame of its onset: 36 ms. Frame for frame, it
    // came 95 ms late.
    expect(Math.abs(frame / 55 - onset)).toBeLessThan(2 / 55)
  })
})
