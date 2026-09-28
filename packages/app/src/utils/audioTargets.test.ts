// Pins the flame writers after their move out of audioAnalysis.ts: what they
// write, the schema hold on render settings, and the re-export.
import { describe, expect, it } from 'vitest'
import * as analysis from './audioAnalysis'
import { flameTargetKey } from './audioMapping'
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

describe('targets that carry ids', () => {
  function flameWithTwoLinear() {
    return {
      transforms: {
        t_first: {
          probability: 0.5,
          variations: {
            v_a: { type: 'linearVar', weight: 1 },
            v_b: { type: 'linearVar', weight: 0.3 },
          },
        },
        t_second: { probability: 0.25, variations: {} },
      },
    }
  }
  const weightOf = (variationId: string, value: number) => ({
    target: {
      kind: 'variationWeight' as const,
      transformIdx: 0,
      transformId: 't_first',
      variationType: 'linearVar',
      variationId,
    },
    value,
  })

  it('drives two variations of one type separately', () => {
    const flame = flameWithTwoLinear()
    applyAudioTargetValues(flame, [weightOf('v_b', 2), weightOf('v_a', 0.5)])
    expect(flame.transforms.t_first.variations.v_a.weight).toBe(0.5)
    expect(flame.transforms.t_first.variations.v_b.weight).toBe(2)
    expect(flameTargetKey(weightOf('v_a', 0).target)).not.toBe(
      flameTargetKey(weightOf('v_b', 0).target),
    )
  })

  it('follows its transform when the flame is reordered', () => {
    const flame = flameWithTwoLinear()
    const probability = {
      kind: 'transformProperty' as const,
      transformIdx: 0,
      transformId: 't_second',
      property: 'probability' as const,
    }
    applyAudioTargetValues(flame, [{ target: probability, value: 0.8 }])
    expect(flame.transforms.t_second.probability).toBe(0.8)
    expect(flame.transforms.t_first.probability).toBe(0.5)
    expect(readTargetValue(flame, probability)).toBe(0.8)
  })

  it('goes inert when its transform or variation is gone', () => {
    const flame = flameWithTwoLinear()
    const before = JSON.stringify(flame)
    const gone = {
      kind: 'transformAffine' as const,
      transformIdx: 0,
      transformId: 't_deleted',
      matrix: 'preAffine' as const,
      param: 'a' as const,
    }
    applyAudioTargetValues(flame, [
      { target: gone, value: 3 },
      weightOf('v_deleted', 3),
    ])
    expect(JSON.stringify(flame)).toBe(before)
    expect(readTargetValue(flame, gone)).toBeUndefined()
  })
})
