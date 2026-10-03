/** Independent component partition, weighted membership and local map choice. */
import { describe, expect, it } from 'vitest'
import { selectWalkGroup, selectWalkGroupTransform, walkGroupMasses, walkGroupProbabilities, walkGroupsOf, walkGroupsSignature, } from './walkGroups'

const transforms = {
  a: { walkGroup: 'head', probability: 1, visible: true },
  b: { walkGroup: 'head', probability: 3, visible: true },
  c: { walkGroup: 'foot', probability: 6, visible: true },
}

describe('independent walker groups', () => {
  it('leaves an ordinary flame and its cache signature unchanged', () => {
    const groups = walkGroupsOf({ a: {}, b: {} })
    expect(groups).toEqual({ enabled: false, groups: [] })
    expect(walkGroupsSignature(groups)).toEqual({})
    expect(walkGroupsOf({})).toEqual(groups)
  })

  it('retains record order and includes mixed untagged maps as one group', () => {
    const groups = walkGroupsOf({
      a: { walkGroup: 'head' },
      b: {},
      c: { walkGroup: 'foot' },
      d: { walkGroup: 'head' },
      e: {},
    })
    expect(groups).toEqual({
      enabled: true,
      groups: [
        { name: 'head', ids: ['a', 'd'] },
        { name: undefined, ids: ['b', 'e'] },
        { name: 'foot', ids: ['c'] },
      ],
    })
    expect(walkGroupsSignature(groups)).toEqual({ walkGroups: groups.groups })
  })

  it('treats names as opaque data, including object property names', () => {
    expect(
      walkGroupsOf({
        a: { walkGroup: '__proto__' },
        b: { walkGroup: 'constructor' },
        c: { walkGroup: '__proto__' },
      }).groups,
    ).toEqual([
      { name: '__proto__', ids: ['a', 'c'] },
      { name: 'constructor', ids: ['b'] },
    ])
  })

  it('allocates membership by group mass, then normalizes maps locally', () => {
    const groups = walkGroupsOf(transforms)
    const masses = walkGroupMasses(groups, transforms)
    expect(masses[0]).toBeCloseTo(0.4, 14)
    expect(masses[1]).toBeCloseTo(0.6, 14)
    expect(selectWalkGroup(masses, 0)).toBe(0)
    expect(selectWalkGroup(masses, 0.399)).toBe(0)
    expect(selectWalkGroup(masses, 0.401)).toBe(1)
    expect(selectWalkGroup(masses, 0.999)).toBe(1)
    const head = groups.groups[0]!
    expect(selectWalkGroupTransform(head, transforms, 0.249)).toBe('a')
    expect(selectWalkGroupTransform(head, transforms, 0.251)).toBe('b')
    expect(selectWalkGroupTransform(head, transforms, 0.999)).toBe('b')
  })

  it('preserves a walkers component for every subsequent map choice', () => {
    const groups = walkGroupsOf(transforms)
    const membership = selectWalkGroup(
      walkGroupMasses(groups, transforms),
      0.3,
    )!
    const group = groups.groups[membership]!
    for (let index = 0; index < 1024; index++) {
      expect(selectWalkGroupTransform(group, transforms, index / 1024)).toBe(
        index < 256 ? 'a' : 'b',
      )
    }
  })

  it('excludes hidden, negative and nonfinite maps from component mass', () => {
    const maps = {
      a: { walkGroup: 'empty', probability: 10, visible: false },
      b: { walkGroup: 'empty', probability: -2, visible: true },
      c: { walkGroup: 'live', probability: 3, visible: true },
      d: { walkGroup: 'empty', probability: Infinity, visible: true },
      e: { walkGroup: 'empty', probability: NaN, visible: true },
    }
    const groups = walkGroupsOf(maps)
    expect(walkGroupProbabilities(maps)).toEqual({
      a: 0,
      b: 0,
      c: 1,
      d: 0,
      e: 0,
    })
    expect(walkGroupMasses(groups, maps)).toEqual([0, 1])
    expect(selectWalkGroup([0, 1], 0)).toBe(1)
    expect(selectWalkGroupTransform(groups.groups[0]!, maps, 0)).toBeUndefined()
  })

  it('does not move an all-zero chain by borrowing another components map', () => {
    const maps = {
      a: { walkGroup: 'head', probability: 0, visible: true },
      b: { walkGroup: 'foot', probability: 1, visible: false },
    }
    const groups = walkGroupsOf(maps)
    expect(walkGroupMasses(groups, maps)).toEqual([0, 0])
    expect(selectWalkGroup([0, 0], 0.5)).toBeUndefined()
    expect(
      selectWalkGroupTransform(groups.groups[0]!, maps, 0.5),
    ).toBeUndefined()
  })

  it('normalizes extreme finite weights without overflow', () => {
    const maps = {
      a: { walkGroup: 'a', probability: Number.MAX_VALUE, visible: true },
      b: { walkGroup: 'b', probability: Number.MAX_VALUE, visible: true },
    }
    expect(walkGroupProbabilities(maps)).toEqual({ a: 0.5, b: 0.5 })
    expect(walkGroupMasses(walkGroupsOf(maps), maps)).toEqual([0.5, 0.5])
  })
})
