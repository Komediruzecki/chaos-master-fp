/** Check solid geometry rest poses, deterministic seeks and conservative floor support. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { solidChunkPosition, solidFragment, solidVertex, } from './pawnSolidShaders'

describe('connected-solid shader', () => {
  it.each([solidVertex, solidFragment])(
    'compiles the native entrypoint',
    (shader) => {
      expect(tgpu.resolve([shader])).toMatch(/@(vertex|fragment)/)
    },
  )

  it.each([-1, 0])(
    'reassembles the exact authored surface at age %s',
    (age) => {
      const point = solidChunkPosition(
        d.vec3f(0.12, -0.08, 0.15),
        d.vec3f(0.2, 0.4, -0.2),
        d.vec3f(1, 1.4, 0.3),
        d.vec3f(1.2, 2.4, -0.8),
        0.3,
        age,
      )
      expect(point.x).toBeCloseTo(0.32, 6)
      expect(point.y).toBeCloseTo(0.32, 6)
      expect(point.z).toBeCloseTo(-0.05, 6)
    },
  )

  it('keeps settled rotating vertices above the board without deforming chunks', () => {
    const centroid = d.vec3f(0, 0.4, 0)
    const velocity = d.vec3f(0.7, 0.8, -0.4)
    const angular = d.vec3f(2.1, -0.7, 1.6)
    const a = d.vec3f(0.12, -0.15, 0.1)
    const b = d.vec3f(-0.14, 0.1, -0.12)
    for (const age of [0.2, 0.4, 0.8, 1.2, 1.6]) {
      const first = solidChunkPosition(a, centroid, velocity, angular, 0.3, age)
      const second = solidChunkPosition(
        b,
        centroid,
        velocity,
        angular,
        0.3,
        age,
      )
      expect(first.y).toBeGreaterThanOrEqual(0)
      expect(second.y).toBeGreaterThanOrEqual(0)
      expect(
        Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z),
      ).toBeCloseTo(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), 6)
      const repeated = solidChunkPosition(
        a,
        centroid,
        velocity,
        angular,
        0.3,
        age,
      )
      expect([repeated.x, repeated.y, repeated.z]).toEqual([
        first.x,
        first.y,
        first.z,
      ])
    }
  })
})
