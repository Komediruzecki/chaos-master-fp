/** Glass breakup must retain interior colours without a bright impact flash. */
import { d } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { glassShardColour } from './pawnGlassShardMaterial'

describe('glass chip optics', () => {
  it('keeps a face-on chip transmissive over a saturated interior', () => {
    const shard = glassShardColour(
      d.vec3f(0, 0, 1),
      d.vec3f(0, 0, 1),
      d.vec3f(1),
      1,
    )
    const interior = [0.04, 0.18, 0.7]
    const blended = [shard.x, shard.y, shard.z].map(
      (channel, index) => channel * shard.w + interior[index]! * (1 - shard.w),
    )
    expect(shard.w).toBeLessThan(0.1)
    expect(blended[2]! - blended[0]!).toBeGreaterThan(0.58)
  })

  it('bounds overlapping-chip radiance and coverage across all viewing directions', () => {
    for (let latitude = -8; latitude <= 8; latitude++) {
      const y = latitude / 8
      const radius = Math.sqrt(1 - y * y)
      for (let longitude = 0; longitude < 32; longitude++) {
        const angle = (longitude * Math.PI) / 16
        const normal = d.vec3f(
          radius * Math.cos(angle),
          y,
          radius * Math.sin(angle),
        )
        const shard = glassShardColour(normal, d.vec3f(0, 0, 1), d.vec3f(1), 1)
        for (const value of [shard.x, shard.y, shard.z]) {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThan(0.75)
        }
        expect(shard.w).toBeLessThanOrEqual(0.395)
        expect(shard.w).toBeGreaterThan(0)
      }
    }
  })

  it('fades coverage without brightening the fragment or producing NaNs opposite the key', () => {
    const magnitude = Math.hypot(-0.45, 0.9, 0.4)
    const view = d.vec3f(0.45 / magnitude, -0.9 / magnitude, -0.4 / magnitude)
    const normal = d.vec3f(0, 1, 0)
    const full = glassShardColour(normal, view, d.vec3f(0.1, 0.6, 0.9), 1)
    const half = glassShardColour(normal, view, d.vec3f(0.1, 0.6, 0.9), 0.5)
    const gone = glassShardColour(normal, view, d.vec3f(0.1, 0.6, 0.9), 0)
    expect([full.x, full.y, full.z].every(Number.isFinite)).toBe(true)
    expect([half.x, half.y, half.z]).toEqual([full.x, full.y, full.z])
    expect(half.w).toBeCloseTo(full.w / 2, 6)
    expect(gone.w).toBe(0)
  })
})
