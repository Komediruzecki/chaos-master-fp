/** Curved patches stay on shared boundaries and normals follow actual deformation. */
import { d } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { gummyCapNormal, gummyCohesiveEdgeFlatten, gummyExposedCapAreaNormal, gummyPnPosition, gummyTransportNormal, } from './gummySurfaceMath'

const a = d.vec3f(0, 0, 0),
  b = d.vec3f(1, 0, 0),
  c = d.vec3f(0, 1, 0)
const unpack = (v: d.v3f) => [v.x, v.y, v.z]

describe('gummy deformed surface reconstruction', () => {
  it('weights exposed cap normals by actual triangle area and ignores still-cohesive faces', () => {
    expect(unpack(gummyExposedCapAreaNormal(a, b, c, 0.999))).toEqual([0, 0, 0])
    expect(unpack(gummyExposedCapAreaNormal(a, b, c, 1))).toEqual([0, 0, 1])
    const larger = gummyExposedCapAreaNormal(a, d.vec3f(2, 0, 0), c, 1)
    expect(unpack(larger)).toEqual([0, 0, 2])
    expect(unpack(gummyExposedCapAreaNormal(a, a, a, 1))).toEqual([0, 0, 0])
    const normal = gummyCapNormal(d.vec3f(0, 1, 2), larger)
    expect(normal.y).toBeCloseTo(1 / Math.sqrt(5), 6)
    expect(normal.z).toBeCloseTo(2 / Math.sqrt(5), 6)
  })

  it('keeps cap normals finite and outward at collapsed or strongly concave corners', () => {
    expect(unpack(gummyCapNormal(d.vec3f(0, 0, -1), d.vec3f(0, 0, 2)))).toEqual(
      [0, 0, 1],
    )
    expect(unpack(gummyCapNormal(d.vec3f(1, 0, 0), d.vec3f(0, 0, 2)))).toEqual([
      0, 0, 1,
    ])
    expect(
      unpack(gummyCapNormal(d.vec3f(0), d.vec3f(0))).every(Number.isFinite),
    ).toBe(true)
  })

  it('keeps an intact or partially damaged edge curved and flattens a released edge', () => {
    const na = d.vec3f(0.8, 0, 0.6),
      nb = d.vec3f(-0.8, 0, 0.6),
      nc = d.vec3f(0, 0, 1)
    for (const damage of [0, 0.4, 0.999]) {
      const mask = gummyCohesiveEdgeFlatten(damage)
      expect(mask).toBe(0)
      const point = gummyPnPosition(
        a,
        b,
        c,
        na,
        nb,
        nc,
        d.vec3f(0.5, 0.5, 0),
        d.vec3f(mask, 0, 0),
      )
      expect(point.x).toBeCloseTo(0.5, 6)
      expect(point.z).toBeCloseTo(-0.12, 6)
    }
    const released = gummyPnPosition(
      a,
      b,
      c,
      na,
      nb,
      nc,
      d.vec3f(0.5, 0.5, 0),
      d.vec3f(gummyCohesiveEdgeFlatten(1), 0, 0),
    )
    expect(unpack(released)).toEqual([0.5, 0, 0])
  })

  it('preserves analytic normals at rest and transports them by inverse transpose under stretch', () => {
    const normal = d.vec3f(1 / Math.sqrt(3))
    const unchanged = gummyTransportNormal(normal, a, b, c, a, b, c)
    for (const value of unpack(unchanged))
      expect(value).toBeCloseTo(1 / Math.sqrt(3), 6)
    const stretched = gummyTransportNormal(
      normal,
      a,
      b,
      c,
      a,
      d.vec3f(2, 0, 0),
      d.vec3f(0, 0.5, 0),
    )
    const magnitude = Math.hypot(0.5, 2, 1)
    expect(stretched.x).toBeCloseTo(0.5 / magnitude, 6)
    expect(stretched.y).toBeCloseTo(2 / magnitude, 6)
    expect(stretched.z).toBeCloseTo(1 / magnitude, 6)
  })

  it('follows a rigidly rotated simulated triangle', () => {
    const normal = d.vec3f(0, 0, 1)
    const rotated = gummyTransportNormal(
      normal,
      a,
      b,
      c,
      a,
      d.vec3f(0, 0, -1),
      c,
    )
    expect(unpack(rotated)).toEqual([1, 0, 0])
  })

  it('remains finite when all current triangle vertices collapse to a point', () => {
    const normal = gummyTransportNormal(d.vec3f(0, 0, 1), a, b, c, a, a, a)
    expect(unpack(normal).every(Number.isFinite)).toBe(true)
    const patch = gummyPnPosition(
      a,
      a,
      a,
      normal,
      normal,
      normal,
      d.vec3f(0.2, 0.3, 0.5),
      d.vec3f(0),
    )
    expect(unpack(patch)).toEqual([0, 0, 0])
  })

  it('reduces to the linear triangle for a flat patch and preserves exact endpoints', () => {
    const normal = d.vec3f(0, 0, 1)
    const point = gummyPnPosition(
      a,
      b,
      c,
      normal,
      normal,
      normal,
      d.vec3f(0.2, 0.3, 0.5),
      d.vec3f(0),
    )
    expect(point.x).toBeCloseTo(0.3, 6)
    expect(point.y).toBeCloseTo(0.5, 6)
    expect(point.z).toBe(0)
    expect(
      unpack(
        gummyPnPosition(
          a,
          b,
          c,
          normal,
          normal,
          normal,
          d.vec3f(1, 0, 0),
          d.vec3f(0),
        ),
      ),
    ).toEqual(unpack(a))
  })

  it('matches an edge curve from either neighbouring face despite different third corners', () => {
    const na = d.vec3f(0, 0.6, 0.8),
      nb = d.vec3f(0.6, 0, 0.8),
      nc = d.vec3f(0, 0, 1)
    const first = gummyPnPosition(
      a,
      b,
      c,
      na,
      nb,
      nc,
      d.vec3f(0.4, 0.6, 0),
      d.vec3f(0),
    )
    const other = gummyPnPosition(
      b,
      a,
      d.vec3f(0, -1, -1),
      nb,
      na,
      d.vec3f(0, -1, 0),
      d.vec3f(0.6, 0.4, 0),
      d.vec3f(0),
    )
    expect(other.x).toBeCloseTo(first.x, 6)
    expect(other.y).toBeCloseTo(first.y, 6)
    expect(other.z).toBeCloseTo(first.z, 6)
  })

  it('keeps a cohesive boundary exactly linear to meet a flat tear cap', () => {
    const na = d.vec3f(0.8, 0, 0.6),
      nb = d.vec3f(-0.8, 0, 0.6),
      nc = d.vec3f(0, 0, 1)
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const point = gummyPnPosition(
        a,
        b,
        c,
        na,
        nb,
        nc,
        d.vec3f(1 - t, t, 0),
        d.vec3f(1, 0, 0),
      )
      expect(point.x).toBeCloseTo(t, 6)
      expect(point.y).toBe(0)
      expect(point.z).toBe(0)
    }
  })
})
