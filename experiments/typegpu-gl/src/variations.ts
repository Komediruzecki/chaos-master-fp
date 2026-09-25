// Reuse the actual source functions; no copied formulas or replacement engine.
import { AffineParams3D } from '@chaos-master/core'
import { d } from 'typegpu'
import { curl3D, linear3D, sinusoidal3D, sphere3D, spherical3D, swirl3D, } from '@/flame/variations/simple3D'
import { VariationInfo3D } from '@/flame/variations/simple3D/types'

export const variationInfo = VariationInfo3D({
  weight: 1,
  affineCoefs: AffineParams3D({
    a: 1,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    f: 1,
    g: 0,
    h: 0,
    i: 0,
    j: 0,
    k: 1,
    l: 0,
  }),
})
export const variations = {
  linear3D,
  spherical3D,
  swirl3D,
  sinusoidal3D,
  sphere3D,
  curl3D,
}
export const fixturePoints = [
  d.vec3f(0.7, 0.2, -0.4),
  d.vec3f(-0.3, 0.8, 0.5),
  d.vec3f(0.02, -0.01, 0.03),
  d.vec3f(0, 0, 0),
  d.vec3f(2, -1.5, 0.5),
]

/** A small Verdant-style chaos game, sampled once on CPU for this GL display. */
export function samplePoints(count = 16384) {
  const output = new Float32Array(count * 4)
  const shifts = [
    [0.55, 0.15, 0.15],
    [-0.4, 0.4, -0.2],
    [-0.2, -0.5, 0.2],
    [0.25, -0.2, -0.5],
  ]
  const angles = [0, 2.1, 4.2, 1.6, 3.8]
  let seed = 73129
  let p = d.vec3f(0.17, -0.23, 0.31)
  let color = 0
  for (let i = -64; i < count; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    const choice = (seed >>> 0) % 5
    if (choice === 4) p = sphere3D.fn(p, variationInfo)
    else {
      const a = angles[choice]
      const shift = shifts[choice]
      const q = d.vec3f(
        0.68 * (p.x * Math.cos(a) - p.y * Math.sin(a)) + shift[0],
        0.68 * (p.x * Math.sin(a) + p.y * Math.cos(a)) + shift[1],
        0.68 * p.z + shift[2],
      )
      const linear = linear3D.fn(q, variationInfo)
      const swirl = swirl3D.fn(q, variationInfo)
      const v = linear.mul(0.7).add(swirl.mul(0.3))
      const b = angles[choice + 1]
      p = d.vec3f(
        v.x * Math.cos(b) - v.y * Math.sin(b),
        v.x * Math.sin(b) + v.y * Math.cos(b),
        v.z,
      )
    }
    color = (color + choice / 4) * 0.5
    if (i >= 0) output.set([p.x, p.y, p.z, color], i * 4)
  }
  if (!output.every(Number.isFinite))
    throw new Error('Non-finite flame samples')
  return output
}
