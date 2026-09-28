// Pins how audio targets keep pointing at what they were wired to: ids are
// attached to legacy targets, followed after a reorder, kept when dangling,
// and re-pointed or dropped when wiring moves to another transform or flame.
import { describe, expect, it } from 'vitest'
import { adoptImportedWiring, reconcileTransformTargets, retargetTransform, } from './audioTargetIds'
import type { AudioMappingEntry, FlameTarget, TransformInfo, } from './audioMapping'

const transforms: TransformInfo[] = [
  {
    id: 't_first',
    index: 0,
    label: 'Transform 1',
    variations: [{ id: 'v_first_0', type: 'linearVar' }],
  },
  {
    id: 't_second',
    index: 1,
    label: 'Transform 2',
    variations: [
      { id: 'v_second_0', type: 'swirlVar' },
      { id: 'v_second_1', type: 'linearVar' },
    ],
  },
]

const wired = (target: FlameTarget): AudioMappingEntry => ({
  audioFeature: 'bass',
  target,
  sensitivity: 1,
  range: [0, 1],
})

describe('reconcileTransformTargets', () => {
  it('gives a legacy target the ids of what it points at', () => {
    const mappings = [
      wired({
        kind: 'variationWeight',
        transformIdx: 1,
        variationType: 'linearVar',
      }),
      wired({ kind: 'renderSetting', param: 'exposure' }),
    ]
    expect(
      reconcileTransformTargets(mappings, transforms).map((m) => m.target),
    ).toEqual([
      {
        kind: 'variationWeight',
        transformIdx: 1,
        transformId: 't_second',
        variationType: 'linearVar',
        variationId: 'v_second_1',
      },
      { kind: 'renderSetting', param: 'exposure' },
    ])
  })

  it('moves a target to where its transform went', () => {
    const mappings = [
      wired({
        kind: 'transformProperty',
        transformIdx: 0,
        transformId: 't_second',
        property: 'probability',
      }),
    ]
    expect(reconcileTransformTargets(mappings, transforms)[0]!.target).toEqual({
      kind: 'transformProperty',
      transformIdx: 1,
      transformId: 't_second',
      property: 'probability',
    })
  })

  it('keeps a target whose transform is gone, and the same array when nothing moved', () => {
    const mappings = [
      wired({
        kind: 'transformProperty',
        transformIdx: 3,
        transformId: 't_deleted',
        property: 'colorX',
      }),
      wired({
        kind: 'transformAffine',
        transformIdx: 0,
        transformId: 't_first',
        matrix: 'preAffine',
        param: 'a',
      }),
    ]
    expect(reconcileTransformTargets(mappings, transforms)).toBe(mappings)
  })
})

describe('retargetTransform', () => {
  it('moves a variation weight to the same type in the other transform', () => {
    const target: FlameTarget = {
      kind: 'variationWeight',
      transformIdx: 0,
      transformId: 't_first',
      variationType: 'linearVar',
      variationId: 'v_first_0',
    }
    expect(retargetTransform(target, transforms[1]!)).toEqual({
      kind: 'variationWeight',
      transformIdx: 1,
      transformId: 't_second',
      variationType: 'linearVar',
      variationId: 'v_second_1',
    })
  })

  it('drops the variation id where the other transform has no such type', () => {
    const target: FlameTarget = {
      kind: 'variationWeight',
      transformIdx: 1,
      transformId: 't_second',
      variationType: 'swirlVar',
      variationId: 'v_second_0',
    }
    expect(retargetTransform(target, transforms[0]!)).toEqual({
      kind: 'variationWeight',
      transformIdx: 0,
      transformId: 't_first',
      variationType: 'swirlVar',
    })
  })
})

describe('adoptImportedWiring', () => {
  it('takes wiring from another flame by position', () => {
    const foreign = [
      wired({
        kind: 'transformAffine',
        transformIdx: 1,
        transformId: 't_elsewhere',
        matrix: 'preAffine',
        param: 'e',
      }),
    ]
    expect(adoptImportedWiring(foreign, transforms)[0]!.target).toEqual({
      kind: 'transformAffine',
      transformIdx: 1,
      transformId: 't_second',
      matrix: 'preAffine',
      param: 'e',
    })
  })

  it('keeps the ids of wiring made for this flame', () => {
    const own = [
      wired({
        kind: 'transformAffine',
        transformIdx: 1,
        transformId: 't_first',
        matrix: 'preAffine',
        param: 'e',
      }),
      wired({
        kind: 'transformAffine',
        transformIdx: 0,
        transformId: 't_deleted',
        matrix: 'preAffine',
        param: 'a',
      }),
    ]
    expect(adoptImportedWiring(own, transforms).map((m) => m.target)).toEqual([
      {
        kind: 'transformAffine',
        transformIdx: 0,
        transformId: 't_first',
        matrix: 'preAffine',
        param: 'e',
      },
      {
        kind: 'transformAffine',
        transformIdx: 0,
        transformId: 't_deleted',
        matrix: 'preAffine',
        param: 'a',
      },
    ])
  })
})
