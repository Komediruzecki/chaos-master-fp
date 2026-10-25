/** Fracture topology rejects pinched links and diagnoses connectivity independently of arbitrary region labels. */
import { describe, expect, it } from 'vitest'
import { analyzeGummyFragments, isManifoldGummyBoundary, partitionGummyCells, } from './gummyPartition'
import type { GummyMesh } from './gummyMesh'

const boundary = (
  a: number,
  b: number,
  c: number,
  d: number,
): [number, number, number][] => [
  [b, c, d],
  [a, d, c],
  [a, b, d],
  [a, c, b],
]
const mesh: GummyMesh = {
  positions: new Float32Array([
    0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0,
    1, 0, 1, 0, 0, -1, 1,
  ]),
  tetrahedra: new Uint32Array([0, 1, 2, 3, 4, 6, 5, 7]),
  interfaces: new Uint32Array([0, 4, 1, 5, 2, 6, 0, 0]),
  surface: new Uint32Array(),
  restNormals: new Float32Array(32),
  nodeRegions: new Uint32Array([11, 11, 11, 11, 47, 47, 47, 47]),
  spacing: 1,
  restVolume: 1 / 3,
  bounds: { min: [0, 0, -1], max: [1, 1, 1] },
  demoGrip: { center: [0, 0, 0], radius: 1, pull: [1, 0, 0] },
}

describe('gummy region topology', () => {
  it('detects a pinched vertex even when every edge has two faces', () => {
    expect(isManifoldGummyBoundary(boundary(0, 1, 2, 3))).toBe(true)
    expect(
      isManifoldGummyBoundary([
        ...boundary(0, 1, 2, 3),
        ...boundary(0, 4, 5, 6),
      ]),
    ).toBe(false)
    expect(
      isManifoldGummyBoundary([
        ...boundary(0, 1, 2, 3),
        ...boundary(0, 1, 4, 5),
      ]),
    ).toBe(false)
    expect(isManifoldGummyBoundary(boundary(0, 1, 2, 3).slice(1))).toBe(false)
  })

  it('splits face-disconnected portions of the same source cell instead of joining them through a point', () => {
    expect(
      partitionGummyCells(
        [
          [0, 1, 2, 3],
          [0, 4, 5, 6],
        ],
        [8, 8],
        new Map([[8, [0, 0, 0]]]),
        [1, 1],
        1,
      ),
    ).toEqual(new Uint32Array([0, 1]))
  })

  it('joins shared faces when their union is a valid closed region', () => {
    expect(
      partitionGummyCells(
        [
          [0, 1, 2, 3],
          [0, 2, 1, 4],
        ],
        [8, 9],
        new Map([
          [8, [0, 0, 0]],
          [9, [0, 0, 1]],
        ]),
        [1, 1],
        1,
      ),
    ).toEqual(new Uint32Array([0, 0]))
  })

  it('rejects inconsistent partition inputs', () => {
    expect(() =>
      partitionGummyCells([[0, 1, 2, 3]], [], new Map(), [1]),
    ).toThrow(RangeError)
    expect(() =>
      partitionGummyCells([[0, 1, 2, 3]], [8], new Map([[8, [0, 0, 0]]]), [0]),
    ).toThrow(RangeError)
    expect(() =>
      partitionGummyCells([[0, 1, 2, 3]], [8], new Map(), [1]),
    ).toThrow('Missing gummy cell center')
  })
})

describe('gummy damage connectivity', () => {
  it('uses generic face connectivity and conserved volumes with noncontiguous region labels', () => {
    const intact = analyzeGummyFragments(mesh)
    expect(intact.regionCount).toBe(2)
    expect(intact.connectedParts).toBe(1)
    expect(intact.components[0]).toEqual({
      restVolume: 1 / 3,
      volumeFraction: 1,
      tetrahedronCount: 2,
      regions: [11, 47],
    })
    const separated = analyzeGummyFragments(mesh, [1])
    expect(separated.connectedParts).toBe(2)
    expect(separated.largestComponentVolumeFraction).toBe(0.5)
    expect(separated.components.map((part) => part.restVolume)).toEqual([
      1 / 6,
      1 / 6,
    ])
    expect(analyzeGummyFragments(mesh, [0.999]).connectedParts).toBe(1)
  })

  it('does not confuse a region label or coincident positions with an actual shared face', () => {
    const disconnected = {
      ...mesh,
      interfaces: new Uint32Array(),
      nodeRegions: new Uint32Array(8),
    }
    const result = analyzeGummyFragments(disconnected)
    expect(result.regionCount).toBe(1)
    expect(result.connectedParts).toBe(2)
  })

  it('rejects mismatched or nonphysical interface damage', () => {
    expect(() => analyzeGummyFragments(mesh, [])).toThrow(RangeError)
    for (const damage of [NaN, Infinity, -0.1, 1.1])
      expect(() => analyzeGummyFragments(mesh, [damage])).toThrow(RangeError)
  })
})
