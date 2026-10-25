/** Runtime tear faces average reflected studio radiance instead of sampling lights along their normal. */
import { d, std, tgpu } from 'typegpu'
import { gummyEnvironment, gummyUnitNormal } from './gummyMaterial'

/** Three rest-topology wet-zone weights share values across adjacent patch edges. */
export const gummyTearAdjacency = tgpu.fn(
  [d.u32, d.vec3f],
  d.f32,
)((packed, barycentric) => {
  'use gpu'
  const opened = d.vec3f(
    d.f32(packed & 255) / 255,
    d.f32((packed >>> 8) & 255) / 255,
    d.f32((packed >>> 16) & 255) / 255,
  )
  return std.clamp(std.dot(opened, barycentric), 0, 1)
})

/** A finite angular sample about the reflected ray; pole directions retain a stable basis. */
export const gummyTearReflectionDirection = tgpu.fn(
  [d.vec3f, d.vec2f],
  d.vec3f,
)((direction, offset) => {
  'use gpu'
  const ray = gummyUnitNormal(direction, d.vec3f(0, 1, 0))
  let axis = d.vec3f(0, 1, 0)
  if (std.abs(ray.y) > 0.9) axis = d.vec3f(1, 0, 0)
  const right = std.normalize(std.cross(axis, ray))
  const up = std.cross(ray, right)
  return std.normalize(
    std.add(ray, std.add(std.mul(right, offset.x), std.mul(up, offset.y))),
  )
})

/** Equal positive weights preserve constant radiance. This is a bounded rough-lobe quadrature,
 * not a microfacet importance sampler or a diffuse light lookup. */
export const gummyTearReflection = tgpu.fn(
  [d.vec3f],
  d.vec3f,
)((direction) => {
  'use gpu'
  let sum = d.vec3f(0)
  for (const x of std.range(-1, 2)) {
    for (const y of std.range(-1, 2)) {
      const sample = gummyTearReflectionDirection(
        direction,
        d.vec2f(d.f32(x) * 0.55, d.f32(y) * 0.55),
      )
      sum = std.add(sum, gummyEnvironment(sample))
    }
  }
  return std.div(sum, 9)
})

/** Thin cut faces retain a rest-dye tint instead of mixing neutral floor light
 * straight into dark pigment. The bounded surface filter is an appearance
 * approximation for wet torn gel; it does not add thickness or change bulk optics. */
export const gummyTearBody = tgpu.fn(
  [d.vec3f, d.vec3f, d.f32],
  d.vec3f,
)((body, dye, cosineLight) => {
  'use gpu'
  const pigment = std.clamp(dye, d.vec3f(0), d.vec3f(1))
  const peak = std.max(std.max(pigment.x, pigment.y), pigment.z)
  const filter = std.sqrt(std.div(pigment, std.max(peak, 0.000001)))
  const filtered = std.mul(body, filter)
  const scatter = std.mul(pigment, 0.4 + 0.6 * std.clamp(cosineLight, 0, 1))
  return std.mix(filtered, scatter, 0.3)
})
