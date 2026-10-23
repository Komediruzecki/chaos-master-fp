/** Collider silhouette checks, including axis-parallel rays and the physical underside. */
import { d } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { GUMMY_PRESS_THICKNESS, gummyBoxHit, gummyPressRimHit, } from './gummyPress'

describe('gummy press intersection', () => {
  const bottom = 1.2
  const min = d.vec3f(-1.1, bottom, -1.1)
  const max = d.vec3f(1.1, bottom + GUMMY_PRESS_THICKNESS, 1.1)

  it('places the visible underside exactly on the collision plane', () => {
    const hit = gummyBoxHit(d.vec3f(0, 0, 0), d.vec3f(0, 1, 0), min, max)
    expect(Array.from(hit.xyz)).toEqual([0, -1, 0])
    expect(hit.w).toBeCloseTo(bottom, 6)
    const above = gummyBoxHit(d.vec3f(0, 3, 0), d.vec3f(0, -1, 0), min, max)
    expect(above.y).toBe(1)
    expect(above.w).toBeCloseTo(3 - bottom - GUMMY_PRESS_THICKNESS)
  })

  it('rejects parallel misses and boxes behind the camera', () => {
    expect(gummyBoxHit(d.vec3f(2, 0, 0), d.vec3f(0, 1, 0), min, max).w).toBe(-1)
    expect(gummyBoxHit(d.vec3f(0, 0, 0), d.vec3f(0, -1, 0), min, max).w).toBe(
      -1,
    )
  })

  it('finds the forward exit when the camera is inside the plate', () => {
    const hit = gummyBoxHit(
      d.vec3f(0, bottom + 0.1, 0),
      d.vec3f(1, 0, 0),
      min,
      max,
    )
    expect(hit.x).toBe(1)
    expect(Math.abs(hit.y) + Math.abs(hit.z)).toBe(0)
    expect(hit.w).toBeCloseTo(1.1, 6)
  })

  it('keeps the observation window clear while intersecting its metal rim', () => {
    const press = d.vec4f(bottom, 1.1, 1, GUMMY_PRESS_THICKNESS)
    const ray = d.vec3f(0, -1, 0)
    expect(gummyPressRimHit(d.vec3f(0, 3, 0), ray, press).w).toBe(-1)
    expect(gummyPressRimHit(d.vec3f(1.08, 3, 0), ray, press).w).toBeCloseTo(
      3 - bottom - GUMMY_PRESS_THICKNESS,
    )
  })
})
