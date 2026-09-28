// Holds the export's per-frame audio step to the live modulation: both export
// paths write each frame's audio through ExportAudioModulation.applyTo, and
// what it writes is eased by the envelopes and held to the comfort caps. An
// export that wrote the mapped values directly would skip both, and nothing
// else would notice.
import { describe, expect, it } from 'vitest'
import { createExportAudioModulation } from './exportAudioModulation'
import type { AudioMappingEntry, FrameData } from './audioMapping'

/**
 * Silence on the first audio frame, full scale on every one after it. At
 * 48 kHz the analyzer's frames are exactly the export's 1/30 s.
 */
const analyzer = {
  sampleRate: 48_000,
  totalFrames: 90,
  getFrameData: (index: number): FrameData & { isBeat: boolean } => ({
    bands: [0, 0, 0, 0, 0, 0, 0, 0],
    rms: index === 0 ? 0 : 1,
    centroid: 0,
    flatness: 0,
    onsetStrength: 0,
    isBeat: false,
  }),
}

const rows: AudioMappingEntry[] = [
  {
    audioFeature: 'rms',
    target: { kind: 'renderSetting', param: 'exposure' },
    sensitivity: 1,
    range: [0, 4],
    attackMs: 100,
  },
  {
    audioFeature: 'rms',
    target: { kind: 'renderSetting', param: 'skipIters' },
    sensitivity: 1,
    range: [0, 10],
    attackMs: 100,
  },
]

describe('an export frame', () => {
  it('carries the eased, governed values, not the mapped ones', () => {
    const modulation = createExportAudioModulation(
      analyzer,
      rows,
      30,
      'standard',
    )
    const written = [0, 1, 2].map((outputFrame) => {
      // A fresh clone per frame, as authored, as both exports make one.
      const flame = { renderSettings: { exposure: 0.25, skipIters: 5 } }
      modulation.applyTo(flame, outputFrame)
      return flame.renderSettings
    })
    // The 100 ms attack takes rms a quarter of the way per 1/30 s frame, so
    // the rows ask for exposure 0, 1, 1.75 and skipIters 0, 2.5, 4.375 (the
    // writer floors those). skipIters is free of the comfort caps; exposure
    // moves from the authored 0.25 by Standard's 0.02 a frame.
    expect(written.map(({ skipIters }) => skipIters)).toEqual([0, 2, 4])
    expect(written.map(({ exposure }) => exposure.toFixed(12))).toEqual(
      [0.23, 0.25, 0.27].map((value) => value.toFixed(12)),
    )
  })
})
