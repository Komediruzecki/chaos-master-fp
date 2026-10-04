/** Actual tetrahedral support bounds curved caps and keeps optical data inside the correct fragment. */
import { d, std, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { gummyBoundedTearPatch, gummyExitTag, gummyMatchingExit, gummyTetInradius, } from './gummyRuntimeSurfaceMath'

describe('runtime tear reconstruction', () => {
  it('uses exact insphere radius and collapses support with a thin or zero-volume tetrahedron', () => {
    const a = d.vec3f(0),
      b = d.vec3f(1, 0, 0),
      c = d.vec3f(0, 1, 0)
    expect(gummyTetInradius(a, b, c, d.vec3f(0, 0, 1))).toBeCloseTo(
      1 / (3 + Math.sqrt(3)),
      6,
    )
    const thin = gummyTetInradius(a, b, c, d.vec3f(0, 0, 0.001))
    expect(thin).toBeGreaterThan(0)
    expect(thin).toBeLessThan(0.0005)
    expect(gummyTetInradius(a, b, c, d.vec3f(0.2, 0.2, 0))).toBe(0)
    expect(gummyTetInradius(a, a, a, a)).toBe(0)
    expect(gummyTetInradius(a, b, c, d.vec3f(0, 0, -1))).toBe(0)
  })

  it('shares the same curved edge between cap and skin, preserving corners and finite displacement limits', () => {
    const a = d.vec3f(0),
      b = d.vec3f(1, 0, 0)
    const na = d.vec3f(-0.8, 0.6, 0),
      nb = d.vec3f(0.8, 0.6, 0)
    for (const t of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
      const cap = gummyBoundedTearPatch(
        a,
        b,
        d.vec3f(0, 1, 0),
        na,
        nb,
        d.vec3f(0, 1, 0),
        d.vec3f(1 - t, t, 0),
        d.vec3f(0.02, 0.01, 0.03),
      )
      const skin = gummyBoundedTearPatch(
        b,
        a,
        d.vec3f(0, 0, 1),
        nb,
        na,
        d.vec3f(0, 0, 1),
        d.vec3f(t, 1 - t, 0),
        d.vec3f(0.01, 0.02, 0.04),
      )
      for (let axis = 0; axis < 3; axis++)
        expect(cap[axis]).toBeCloseTo(skin[axis]!, 7)
      expect(std.length(std.sub(cap, d.vec3f(t, 0, 0)))).toBeLessThanOrEqual(
        0.02 * (1 - t) + 0.01 * t + 1e-7,
      )
    }
    const bounded = gummyBoundedTearPatch(
      a,
      b,
      d.vec3f(0, 1, 0),
      na,
      nb,
      d.vec3f(0, 1, 0),
      d.vec3f(0.5, 0.5, 0),
      d.vec3f(0),
    )
    expect(Array.from(bounded)).toEqual([0.5, 0, 0])
  })

  it('retains distinct exact IDs in half-float integer lanes and rejects other fragments or empty exits', () => {
    for (const component of [0, 1, 2047, 2048, 2049, 4095, 65535]) {
      const tag = gummyExitTag(component)
      expect(Number.isInteger(tag.x) && Number.isInteger(tag.y)).toBe(true)
      expect(tag.x).toBeGreaterThanOrEqual(1)
      expect(tag.x).toBeLessThanOrEqual(1024)
      expect(tag.y).toBeLessThan(2048)
      expect(gummyMatchingExit(component, tag, 0.1)).toBe(true)
      expect(gummyMatchingExit(component + 1, tag, 0.1)).toBe(false)
      expect(gummyMatchingExit(component, tag, -0.1)).toBe(false)
      expect(gummyMatchingExit(component + 0.0002, tag, 0.1)).toBe(true)
      expect(Array.from(gummyExitTag(component + 0.0002))).toEqual(
        Array.from(tag),
      )
    }
    expect(gummyMatchingExit(0, d.vec2f(0), 1)).toBe(false)
  })

  it('resolves the actual curved patch and fragment-provenance shader helpers', () => {
    const source = tgpu.resolve(
      [
        gummyBoundedTearPatch,
        gummyExitTag,
        gummyMatchingExit,
        gummyTetInradius,
      ],
      { names: 'strict' },
    )
    expect(source).toContain('gummyPnPosition')
    expect(source).not.toContain('NaN')
  })
})
