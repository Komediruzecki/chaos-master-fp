// Pins the mapping stage after its move out of audioAnalysis.ts: the values it
// settles, and the re-export every existing importer still reaches it through.
import { describe, expect, it } from 'vitest'
import * as analysis from './audioAnalysis'
import { flameTargetKey, resolveAudioMappingValues } from './audioMapping'
import type { AudioMappingEntry, FrameData } from './audioMapping'

function frame(bass: number): FrameData & { isBeat: boolean } {
  return {
    bands: [0, bass, 0, 0, 0, 0, 0, 0],
    rms: 0,
    centroid: 0,
    flatness: 0,
    onsetStrength: 0,
    isBeat: false,
  }
}

const bassToVibrancy: AudioMappingEntry = {
  audioFeature: 'bass',
  target: { kind: 'renderSetting', param: 'vibrancy' },
  sensitivity: 1,
  range: [0.5, 1.5],
}

describe('audioMapping', () => {
  it('settles a band feature into the mapping range', () => {
    const { values, changed } = resolveAudioMappingValues(frame(0.5), [
      bassToVibrancy,
    ])
    expect(changed).toBe(true)
    expect(values).toEqual([{ target: bassToVibrancy.target, value: 1 }])
  })

  it('is the module audioAnalysis re-exports', () => {
    expect(analysis.resolveAudioMappingValues).toBe(resolveAudioMappingValues)
    expect(analysis.flameTargetKey).toBe(flameTargetKey)
  })
})
