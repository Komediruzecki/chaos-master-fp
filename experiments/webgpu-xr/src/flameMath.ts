// A bounded chaos-game step using the application's unchanged 3D variations.
import { d, std, tgpu } from 'typegpu'
import { linear3D, sphere3D, swirl3D } from '@/flame/variations/simple3D'
import { VariationInfo3D } from '@/flame/variations/simple3D/types'
import { variationInfo } from '../../typegpu-gl/src/variations'

const info = tgpu.const(VariationInfo3D, variationInfo)
const transforms = tgpu.const(d.arrayOf(d.vec4f, 4), [
  d.vec4f(0, 0.55, 0.15, 0.15),
  d.vec4f(2.1, -0.4, 0.4, -0.2),
  d.vec4f(4.2, -0.2, -0.5, 0.2),
  d.vec4f(1.6, 0.25, -0.2, -0.5),
])
const postAngles = tgpu.const(d.arrayOf(d.f32, 4), [2.1, 4.2, 1.6, 3.8])

export const advanceSeed = tgpu.fn(
  [d.u32],
  d.u32,
)((value) => {
  'use gpu'
  let seed = d.u32(value)
  seed = seed ^ (seed << 13)
  seed = seed ^ (seed >>> 17)
  seed = seed ^ (seed << 5)
  return d.u32(seed)
})

export const advancePoint = tgpu.fn(
  [d.vec4f, d.u32],
  d.vec4f,
)((point, seed) => {
  'use gpu'
  const choice = seed % 5
  let p = d.vec3f(point.xyz)
  if (choice === 4) p = sphere3D.fn(p, info.$)
  else {
    const t = transforms.$[choice]
    const q = d.vec3f(
      0.68 * (p.x * std.cos(t.x) - p.y * std.sin(t.x)) + t.y,
      0.68 * (p.x * std.sin(t.x) + p.y * std.cos(t.x)) + t.z,
      0.68 * p.z + t.w,
    )
    const v = linear3D
      .fn(q, info.$)
      .mul(0.7)
      .add(swirl3D.fn(q, info.$).mul(0.3))
    const b = postAngles.$[choice]
    p = d.vec3f(
      v.x * std.cos(b) - v.y * std.sin(b),
      v.x * std.sin(b) + v.y * std.cos(b),
      v.z,
    )
  }
  return d.vec4f(p, (point.w + d.f32(choice) / 4) * 0.5)
})
