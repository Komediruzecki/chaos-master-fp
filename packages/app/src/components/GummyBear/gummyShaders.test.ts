/** Compile real GPU entrypoints and check filled-volume optics independently of a browser. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { GUMMY_IOR, GUMMY_MATERIALS, gummyEnvironment, gummyFresnel, gummyOpticalPath, gummyTransmission, gummyUnitNormal, } from './gummyMaterial'
import { gummyBackgroundFragment, gummyBrokenEdgeFlatten, gummyCausticFragment, gummyCausticVertex, gummyDisplayFragment, gummyExitFragment, gummyFragment, gummyFrontTagFragment, gummyNormalsCompute, gummyRuntimeExitFragment, gummyShadowFragment, gummyShadowVertex, gummyVertex, } from './gummyShaders'

describe('gummy native shading', () => {
  it('resolves bounded dynamic edge traversal in all surface passes', () => {
    const helper = tgpu.resolve([gummyBrokenEdgeFlatten], { names: 'strict' })
    expect(helper).toContain('arrayLength')
    expect(helper).toContain('gummyCohesiveEdgeFlatten')
    for (const shader of [gummyVertex, gummyShadowVertex, gummyCausticVertex]) {
      const source = tgpu.resolve([shader], { names: 'strict' })
      expect(source).toContain('gummyBrokenEdgeFlatten')
      expect(source).toContain('gummyPnPosition')
    }
  })

  it.each([
    gummyVertex,
    gummyExitFragment,
    gummyFrontTagFragment,
    gummyRuntimeExitFragment,
    gummyFragment,
    gummyCausticVertex,
    gummyCausticFragment,
    gummyShadowVertex,
    gummyShadowFragment,
    gummyBackgroundFragment,
    gummyDisplayFragment,
    gummyNormalsCompute,
  ])('resolves each native entrypoint', (shader) => {
    const source = tgpu.resolve([shader], { names: 'strict' })
    expect(source).toMatch(/@(vertex|fragment|compute)/)
  })

  it('absorbs through the entire volume and compounds with physical path length', () => {
    const coefficients = d.vec3f(...GUMMY_MATERIALS.blue.absorption)
    const zero = gummyTransmission(coefficients, 0)
    const one = gummyTransmission(coefficients, 0.5)
    const two = gummyTransmission(coefficients, 1)
    expect([zero.x, zero.y, zero.z]).toEqual([1, 1, 1])
    expect(one.x).toBeCloseTo(
      Math.exp(-GUMMY_MATERIALS.blue.absorption[0] * 0.5),
      6,
    )
    expect(two.x).toBeCloseTo(one.x * one.x, 6)
    expect(two.y).toBeCloseTo(one.y * one.y, 6)
    expect(two.z).toBeGreaterThan(two.y)
    expect(two.y).toBeGreaterThan(two.x)
  })

  it('preserves physical normal-incidence reflection and the grazing limit', () => {
    expect(gummyFresnel(1)).toBeCloseTo(
      ((GUMMY_IOR - 1) / (GUMMY_IOR + 1)) ** 2,
      7,
    )
    expect(gummyFresnel(0)).toBe(1)
    expect(gummyFresnel(-1)).toBe(1)
  })

  it('keeps rounded-body dye at oblique angles while preserving planar tear-cap optics', () => {
    const radius = 0.5,
      cosV = 0.2
    const cosT = Math.sqrt(1 - (1 - cosV * cosV) / (GUMMY_IOR * GUMMY_IOR))
    const chord = 2 * radius * cosV
    expect(gummyOpticalPath(chord, cosV, cosT, 0)).toBeCloseTo(
      2 * radius * cosT,
      6,
    )
    expect(gummyOpticalPath(chord, cosV, cosT, 1)).toBeCloseTo(
      (chord * cosV) / cosT,
      6,
    )
    expect(gummyOpticalPath(0.7, 1, 1, 0)).toBeCloseTo(0.7, 6)
    expect(gummyOpticalPath(0.7, 1, 1, 1)).toBeCloseTo(0.7, 6)
    expect(Number.isFinite(gummyOpticalPath(0.01, 0, 0, 0))).toBe(true)
    expect(gummyOpticalPath(10, 0.2, 0.8, 0)).toBeCloseTo(2.4, 6)
  })

  it('keeps finite normals for collapsed tear triangles and a usable HDR key', () => {
    const normal = gummyUnitNormal(d.vec3f(0), d.vec3f(0, 4, 0))
    expect([normal.x, normal.y, normal.z]).toEqual([0, 1, 0])
    const finalFallback = gummyUnitNormal(d.vec3f(0), d.vec3f(0))
    expect([finalFallback.x, finalFallback.y, finalFallback.z]).toEqual([
      0, 1, 0,
    ])
    const length = Math.hypot(-0.55, 0.62, 0.55)
    const key = gummyEnvironment(
      d.vec3f(-0.55 / length, 0.62 / length, 0.55 / length),
    )
    expect(key.x).toBeGreaterThan(3.5)
    expect([key.x, key.y, key.z].every(Number.isFinite)).toBe(true)
  })
})
