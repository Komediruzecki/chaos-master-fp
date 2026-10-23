/** Exact plate ray intersections and studio shading for the gummy compression collider. */
import { d, std, tgpu } from 'typegpu'
import { gummyEnvironment } from './gummyMaterial'

export const GUMMY_PRESS_THICKNESS = 0.18
const PRESS_RIM = 0.035

/** Normal in xyz and forward ray distance in w; a negative distance means no hit. */
export const gummyBoxHit = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f],
  d.vec4f,
)((origin, direction, minimum, maximum) => {
  'use gpu'
  let near = d.f32(-1e20)
  let far = d.f32(1e20)
  let nearNormal = d.vec3f(0)
  let farNormal = d.vec3f(0)
  for (let axis = d.u32(0); axis < 3; axis++) {
    const ray = direction[axis]!
    const start = origin[axis]!
    if (std.abs(ray) < 0.000001) {
      if (start < minimum[axis]! || start > maximum[axis]!)
        return d.vec4f(0, 0, 0, -1)
    } else {
      const first = (minimum[axis]! - start) / ray
      const second = (maximum[axis]! - start) / ray
      const entry = std.min(first, second)
      const exit = std.max(first, second)
      const normal = d.vec3f(0)
      normal[axis] = -std.sign(ray)
      if (entry > near) {
        near = entry
        nearNormal = d.vec3f(normal)
      }
      if (exit < far) {
        far = exit
        farNormal = std.mul(normal, -1)
      }
      if (near > far) return d.vec4f(0, 0, 0, -1)
    }
  }
  if (far < 0) return d.vec4f(0, 0, 0, -1)
  if (near >= 0) return d.vec4f(nearNormal, near)
  return d.vec4f(farNormal, far)
})

/** Four narrow metal rails leave the clear platen's center visible during compression. */
export const gummyPressRimHit = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec4f],
  d.vec4f,
)((origin, direction, press) => {
  'use gpu'
  let result = d.vec4f(0, 0, 0, -1)
  for (let edge = d.u32(0); edge < 4; edge++) {
    const minimum = d.vec3f(-press.y, press.x, -press.y)
    const maximum = d.vec3f(press.y, press.x + press.w, press.y)
    if (edge === 0) maximum.x = -press.y + PRESS_RIM
    if (edge === 1) minimum.x = press.y - PRESS_RIM
    if (edge === 2) maximum.z = -press.y + PRESS_RIM
    if (edge === 3) minimum.z = press.y - PRESS_RIM
    const hit = gummyBoxHit(origin, direction, minimum, maximum)
    if (hit.w >= 0 && (result.w < 0 || hit.w < result.w)) result = d.vec4f(hit)
  }
  return result
})

export const gummyPressColour = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((normal, incident) => {
  'use gpu'
  const key = std.max(
    0,
    std.dot(normal, std.normalize(d.vec3f(-0.55, 0.8, 0.5))),
  )
  const reflected = gummyEnvironment(std.reflect(incident, normal))
  const rim = std.pow(1 - std.max(0, -std.dot(incident, normal)), 4)
  return std.add(
    std.mul(d.vec3f(0.12, 0.15, 0.17), 0.45 + key * 1.3),
    std.mul(reflected, 0.06 + rim * 0.16),
  )
})
