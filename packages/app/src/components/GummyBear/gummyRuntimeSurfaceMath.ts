/** Bounded curved tear patches and optical provenance driven by actual tetrahedral support. */
import { d, std, tgpu } from 'typegpu'
import { gummyPnPosition } from './gummySurfaceMath'

/** Insphere radius 3V/A; vanishing or inverted elements cannot invent a thick render shell. */
export const gummyTetInradius = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f],
  d.f32,
)((a, b, c, q) => {
  'use gpu'
  const ab = std.sub(b, a)
  const ac = std.sub(c, a)
  const aq = std.sub(q, a)
  const volume6 = std.dot(ab, std.cross(ac, aq))
  if (volume6 <= 0) return d.f32(0)
  const area2 =
    std.length(std.cross(ab, ac)) +
    std.length(std.cross(ab, aq)) +
    std.length(std.cross(ac, aq)) +
    std.length(std.cross(std.sub(c, b), std.sub(q, b)))
  return volume6 / std.max(area2, 0.000000001)
})

/** Per-node bounds agree on shared edges; only existing tetrahedral boundaries are rounded. */
export const gummyBoundedTearPatch = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f],
  d.vec3f,
)((a, b, c, na, nb, nc, bary, bounds) => {
  'use gpu'
  const linear = std.add(
    std.add(std.mul(a, bary.x), std.mul(b, bary.y)),
    std.mul(c, bary.z),
  )
  const patch = gummyPnPosition(a, b, c, na, nb, nc, bary, d.vec3f(0))
  const offset = std.sub(patch, linear)
  const limit = std.max(std.dot(bounds, bary), 0)
  const scale = std.min(1, limit / std.max(std.length(offset), 0.000001))
  return std.add(linear, std.mul(offset, scale))
})

/** A nearest back surface of another fragment cannot supply this fragment's thickness or dye. */
export const gummyExitTag = tgpu.fn(
  [d.f32],
  d.vec2f,
)((component) => {
  'use gpu'
  const id = std.round(component)
  const high = std.floor(id / 1024)
  return d.vec2f(id - high * 1024 + 1, high + 1)
})

export const gummyMatchingExit = tgpu.fn(
  [d.f32, d.vec2f, d.f32],
  d.bool,
)((component, tag, path) => {
  'use gpu'
  const exitComponent = tag.x - 1 + (tag.y - 1) * 1024
  return (
    tag.x > 0 && tag.y > 0 && std.round(component) === exitComponent && path > 0
  )
})
