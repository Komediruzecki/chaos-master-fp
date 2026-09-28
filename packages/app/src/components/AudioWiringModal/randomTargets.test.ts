// Pins the transform targets the wiring editor's Randomize draws from.
import { describe, expect, it } from 'vitest'
import { transformTargetPool } from './randomTargets'
import type { TransformInfo } from '@/utils/audioAnalysis'

const transform: TransformInfo = {
  id: 't_example',
  index: 2,
  label: 'Transform 3',
  variations: [
    { id: 'v_first', type: 'linearVar' },
    { id: 'v_second', type: 'swirlVar' },
  ],
}

describe('transformTargetPool', () => {
  it('offers the scale pair, the probability and the variation picked', () => {
    expect(transformTargetPool(transform, (count) => count - 1)).toEqual([
      {
        kind: 'transformAffine',
        transformIdx: 2,
        transformId: 't_example',
        matrix: 'preAffine',
        param: 'a',
      },
      {
        kind: 'transformAffine',
        transformIdx: 2,
        transformId: 't_example',
        matrix: 'preAffine',
        param: 'e',
      },
      {
        kind: 'transformProperty',
        transformIdx: 2,
        transformId: 't_example',
        property: 'probability',
      },
      {
        kind: 'variationWeight',
        transformIdx: 2,
        transformId: 't_example',
        variationType: 'swirlVar',
        variationId: 'v_second',
      },
    ])
  })

  it('offers no variation weight for a transform without variations', () => {
    expect(
      transformTargetPool({ ...transform, variations: [] }, () => 0),
    ).toHaveLength(3)
  })
})
