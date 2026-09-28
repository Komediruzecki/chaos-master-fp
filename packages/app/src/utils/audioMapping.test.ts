// Pins the mapping stage after its move out of audioAnalysis.ts: the values it
// settles, and the re-export every existing importer still reaches it through.
import { describe, expect, it } from 'vitest'
import * as analysis from './audioAnalysis'
import { dirtyThreshold, flameTargetKey, resolveAudioMappingValues, } from './audioMapping'
import type { AudioMappingEntry, FrameData, MappingSmoothingState, TargetLimiter, } from './audioMapping'

function frame(
  bass: number,
  mid = 0,
  rms = 0,
): FrameData & { isBeat: boolean } {
  return {
    bands: [0, bass, 0, mid, 0, 0, 0, 0],
    rms,
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

const midToExposure: AudioMappingEntry = {
  audioFeature: 'mid',
  target: { kind: 'renderSetting', param: 'exposure' },
  sensitivity: 1,
  range: [0, 2],
}

describe('the dirty check', () => {
  it('is 0.2% of the output range, never below 1e-6', () => {
    expect(dirtyThreshold(midToExposure)).toBeCloseTo(0.004, 12)
    expect(dirtyThreshold({ ...midToExposure, range: [1, 1.1] })).toBeCloseTo(
      0.0002,
      12,
    )
    expect(dirtyThreshold({ ...midToExposure, range: [3, 3] })).toBe(1e-6)
  })

  it('moves a target whose output moved by 0.2% of its range', () => {
    const state: MappingSmoothingState = new Map()
    resolveAudioMappingValues(frame(0, 0.1), [midToExposure], state)
    const next = resolveAudioMappingValues(
      frame(0, 0.103),
      [midToExposure],
      state,
    )
    expect(next.changed).toBe(true)
    expect(next.values[0]!.value).toBeCloseTo(0.206, 12)
  })

  it('holds a move below 0.2% of the output range', () => {
    const state: MappingSmoothingState = new Map()
    resolveAudioMappingValues(frame(0, 0.1), [midToExposure], state)
    const next = resolveAudioMappingValues(
      frame(0, 0.1015),
      [midToExposure],
      state,
    )
    expect(next.changed).toBe(false)
    expect(next.values[0]!.value).toBeCloseTo(0.2, 12)
  })
})

describe('a target limiter', () => {
  it('keeps a frame changed while the limited output is still moving', () => {
    let out = 0
    const halfway: TargetLimiter = (_target, _key, value) => {
      out += (value - out) / 2
      return out
    }
    const rmsToExposure: AudioMappingEntry = {
      ...midToExposure,
      audioFeature: 'rms',
      range: [0, 1],
    }
    const state: MappingSmoothingState = new Map()
    const flags: boolean[] = []
    for (let tick = 0; tick < 12; tick++) {
      flags.push(
        resolveAudioMappingValues(
          frame(0, 0, 1),
          [rmsToExposure],
          state,
          1 / 30,
          halfway,
        ).changed,
      )
    }
    // The input never moves after the first frame. The output halves its
    // distance each frame, and a frame counts as changed until the output has
    // crept within 0.2% of the last one published.
    expect(flags).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      true,
      false,
      false,
    ])
  })

  it('limits only the mapping that wins a shared target', () => {
    const keys: string[] = []
    const record: TargetLimiter = (_target, key, value) => {
      keys.push(key)
      return value
    }
    const both: AudioMappingEntry[] = [
      midToExposure,
      { ...midToExposure, audioFeature: 'rms' },
    ]
    const { values } = resolveAudioMappingValues(
      frame(0, 0.5, 0.25),
      both,
      new Map(),
      1 / 30,
      record,
    )
    expect(keys).toEqual(['render.exposure'])
    expect(values.map(({ value }) => value)).toEqual([1, 0.5])
  })
})
