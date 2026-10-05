/** Floor-light projection and flux conservation regressions, independent of camera and raster size. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { marchingGummyFloorProjection, marchingGummyFlux, marchingGummyLightFragment, marchingGummyLightVertex, marchingGummyShadowFragment, marchingGummyShadowTriangleProjection, marchingGummyShadowVertex, } from './marchingGummyLight'

describe('marching gummy floor light', () => {
  it.each([
    marchingGummyLightVertex,
    marchingGummyLightFragment,
    marchingGummyShadowVertex,
    marchingGummyShadowFragment,
  ])('resolves the native mesh shader', (shader) => {
    const source = tgpu.resolve([shader], { names: 'strict' })
    expect(source).toMatch(/@(vertex|fragment)/)
    expect(source).not.toContain('NaN')
  })

  it('projects a downward ray to the ground in world coordinates', () => {
    const floor = marchingGummyFloorProjection(
      d.vec3f(1, 2, -1),
      d.vec3f(0.2, -0.5, 0.3),
    )
    expect(floor.x).toBeCloseTo(1.8, 6)
    expect(floor.y).toBe(0)
    expect(floor.z).toBeCloseTo(0.2, 6)
    expect(floor.w).toBe(1)
  })

  it('rejects upward, grazing and buried rays without a fictitious focal point', () => {
    for (const direction of [
      d.vec3f(1, 0, 0),
      d.vec3f(0, 1, 0),
      d.vec3f(1, -0.01, 0),
    ]) {
      expect([
        ...marchingGummyFloorProjection(d.vec3f(0, 2, 0), direction),
      ]).toEqual([0, 0, 0, 0])
    }
    expect([
      ...marchingGummyFloorProjection(d.vec3f(0, -0.1, 0), d.vec3f(0, -1, 0)),
    ]).toEqual([0, 0, 0, 0])
  })

  it('conserves incident flux during defocus and focus before the finite-energy cap', () => {
    expect(marchingGummyFlux(0.6, 1.2)).toBeCloseTo(0.5, 6)
    expect(marchingGummyFlux(0.6, 0.15)).toBeCloseTo(4, 6)
    expect(marchingGummyFlux(0.6, 0.15) * 0.15).toBeCloseTo(0.6, 6)
    // Refining a planar triangle cannot change irradiance or total received flux.
    expect(marchingGummyFlux(0.15, 0.0375)).toBeCloseTo(4, 6)
    expect(marchingGummyFlux(0.15, 0.0375) * 0.0375 * 4).toBeCloseTo(0.6, 6)
  })

  it('loses rather than creates energy at a collapsed focus and rejects backfaces', () => {
    expect(marchingGummyFlux(0.6, 0.0001)).toBe(8)
    expect(marchingGummyFlux(0.6, 0.0001) * 0.0001).toBeLessThan(0.6)
    expect(marchingGummyFlux(0.6, 0)).toBe(0)
    expect(marchingGummyFlux(0, 0.2)).toBe(0)
    expect(marchingGummyFlux(-0.6, 0.2)).toBe(0)
  })
  it('rejects all three shadow corners when any corner is below the floor', () => {
    for (const buried of [0, 1, 2]) {
      const triangle = [
        d.vec3f(-0.3, 0.1, 0),
        d.vec3f(0.3, 0.2, 0),
        d.vec3f(0, 0.1, 0.3),
      ]
      triangle[buried]!.y = -0.001
      for (const corner of [0, 1, 2])
        expect([
          ...marchingGummyShadowTriangleProjection(
            triangle[0]!,
            triangle[1]!,
            triangle[2]!,
            corner,
          ),
        ]).toEqual([0, 0, 0, 0])
    }
    const source = tgpu.resolve([marchingGummyShadowVertex], {
      names: 'strict',
    })
    expect(source).toContain('marchingGummyShadowTriangleProjection')
  })

  it('keeps every valid shadow corner at its own floor projection including floor contact', () => {
    const triangle = [
      d.vec3f(-0.3, 0, 0),
      d.vec3f(0.3, 0.2, 0),
      d.vec3f(0, 0.1, 0.3),
    ]
    const length = Math.hypot(0.42, 0.87, 0.26)
    const direction = d.vec3f(0.42 / length, -0.87 / length, -0.26 / length)
    for (const corner of [0, 1, 2]) {
      const actual = marchingGummyShadowTriangleProjection(
        triangle[0]!,
        triangle[1]!,
        triangle[2]!,
        corner,
      )
      const expected = marchingGummyFloorProjection(
        triangle[corner]!,
        direction,
      )
      expect(actual.w).toBe(1)
      expect(actual.x).toBeCloseTo(expected.x, 6)
      expect(actual.z).toBeCloseTo(expected.z, 6)
    }
  })
})
