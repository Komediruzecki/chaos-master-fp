// Pins the entity ids an audio target may carry: optional, safe ids only, and
// a wiring written before targets carried them still parses.
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { FlameTarget } from './audioWiring'

describe('audio target ids', () => {
  it('accepts transform and variation ids beside the position', () => {
    const target = {
      kind: 'variationWeight',
      transformIdx: 1,
      transformId: 't_second',
      variationType: 'linearVar',
      variationId: 'v_second_0',
    }
    expect(v.parse(FlameTarget, target)).toEqual(target)
  })

  it('still parses a target with no ids', () => {
    const target = {
      kind: 'transformAffine',
      transformIdx: 0,
      matrix: 'preAffine',
      param: 'a',
    }
    expect(v.parse(FlameTarget, target)).toEqual(target)
  })

  it('rejects an id that is not a flame entity id', () => {
    for (const transformId of ['', '__proto__', 'a-b', 'x'.repeat(129)]) {
      const result = v.safeParse(FlameTarget, {
        kind: 'transformProperty',
        transformIdx: 0,
        transformId,
        property: 'probability',
      })
      expect(result.success).toBe(false)
      expect(result.issues?.[0]?.message).toBe('Expected a flame entity id')
    }
  })
})
