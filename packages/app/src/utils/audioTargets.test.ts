// Pins the flame writers after their move out of audioAnalysis.ts: what they
// write, the schema hold on render settings, and the re-export.
import { describe, expect, it } from 'vitest'
import * as analysis from './audioAnalysis'
import { applyAudioMappingsToFlame, applyAudioTargetValues, readTargetValue, } from './audioTargets'

describe('audioTargets', () => {
  it('writes a render setting into the flame it is given', () => {
    const flame: Record<string, unknown> = {
      renderSettings: { exposure: 0.25 },
    }
    applyAudioTargetValues(flame, [
      { target: { kind: 'renderSetting', param: 'exposure' }, value: 0.75 },
    ])
    expect(flame.renderSettings).toEqual({ exposure: 0.75 })
  })

  it('wraps palettePhase the way the shader reads it', () => {
    const flame: Record<string, unknown> = { renderSettings: {} }
    applyAudioTargetValues(flame, [
      { target: { kind: 'renderSetting', param: 'palettePhase' }, value: 1.25 },
    ])
    expect(flame.renderSettings).toEqual({ palettePhase: 0.25 })
  })

  it('is the module audioAnalysis re-exports', () => {
    expect(analysis.applyAudioTargetValues).toBe(applyAudioTargetValues)
    expect(analysis.applyAudioMappingsToFlame).toBe(applyAudioMappingsToFlame)
  })
})

describe('readTargetValue', () => {
  const flame = {
    renderSettings: { exposure: 0.25, camera: { zoom: 1.5 } },
    transforms: {
      t0: {
        probability: 0.4,
        preAffine: { a: 0.9, b: 0, c: 0.1, d: 0, e: 0.8, f: 0 },
        postAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
        color: { x: 0.3, y: 0.6 },
        colorSpeed: 0.45,
        variations: { v0: { type: 'linearVar', weight: 0.7 } },
      },
    },
    finalTransform: { a: 1, b: 0, c: 0.05, d: 0, e: 1, f: 0 },
  }

  it('reads each kind of target from the flame as authored', () => {
    expect([
      readTargetValue(flame, { kind: 'renderSetting', param: 'exposure' }),
      readTargetValue(flame, { kind: 'renderSetting', param: 'zoom' }),
      readTargetValue(flame, {
        kind: 'transformAffine',
        transformIdx: 0,
        matrix: 'preAffine',
        param: 'e',
      }),
      readTargetValue(flame, {
        kind: 'transformProperty',
        transformIdx: 0,
        property: 'probability',
      }),
      readTargetValue(flame, {
        kind: 'transformProperty',
        transformIdx: 0,
        property: 'colorY',
      }),
      readTargetValue(flame, {
        kind: 'transformProperty',
        transformIdx: 0,
        property: 'colorSpeed',
      }),
      readTargetValue(flame, {
        kind: 'variationWeight',
        transformIdx: 0,
        variationType: 'linearVar',
      }),
      readTargetValue(flame, { kind: 'finalAffine', param: 'c' }),
    ]).toEqual([0.25, 1.5, 0.8, 0.4, 0.6, 0.45, 0.7, 0.05])
  })

  it('is undefined for what the flame does not carry', () => {
    expect([
      readTargetValue(flame, { kind: 'renderSetting', param: 'vibrancy' }),
      readTargetValue(flame, {
        kind: 'transformAffine',
        transformIdx: 3,
        matrix: 'preAffine',
        param: 'a',
      }),
      readTargetValue(flame, {
        kind: 'variationWeight',
        transformIdx: 0,
        variationType: 'swirlVar',
      }),
      readTargetValue({}, { kind: 'finalAffine', param: 'a' }),
    ]).toEqual([undefined, undefined, undefined, undefined])
  })
})
