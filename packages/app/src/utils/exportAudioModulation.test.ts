// Pins export audio modulation: the live step replayed at the export's frame
// rate, from a fresh state, with sub-frames and backward seeks answered from
// the same sequence.
import { describe, expect, it } from 'vitest'
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

const source = { totalFrames: 90, getFrameData: frameAt }

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
})
