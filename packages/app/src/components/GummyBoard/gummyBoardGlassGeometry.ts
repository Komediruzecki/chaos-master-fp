/** Beveled slab intersections, glass surface normals and support feet. */
import { perlin2d } from '@typegpu/noise'
import { d, std, tgpu } from 'typegpu'
import { gummyEnvironment } from '../GummyBear/gummyMaterial'
import { gummyBoxHit } from '../GummyBear/gummyPress'
import { GUMMY_BOARD_GRID, GUMMY_BOARD_SLAB } from './gummyBoardGrid'
import { gummyBoardGlassInset } from './gummyBoardGridShaders'
import { GUMMY_BOARD_GLASS_FLOOR } from './gummyBoardThemes'

// Half-space n·p <= w. The bevel stays outside all 64 playable squares.
const slabPlanes = tgpu.const(d.arrayOf(d.vec4f, 10), [
  d.vec4f(1, 0, 0, GUMMY_BOARD_SLAB.halfExtent),
  d.vec4f(-1, 0, 0, GUMMY_BOARD_SLAB.halfExtent),
  d.vec4f(0, 1, 0, GUMMY_BOARD_GRID.top),
  d.vec4f(0, -1, 0, -GUMMY_BOARD_SLAB.bottom),
  d.vec4f(0, 0, 1, GUMMY_BOARD_SLAB.halfExtent),
  d.vec4f(0, 0, -1, GUMMY_BOARD_SLAB.halfExtent),
  d.vec4f(
    1,
    1,
    0,
    GUMMY_BOARD_SLAB.halfExtent - GUMMY_BOARD_SLAB.bevel + GUMMY_BOARD_GRID.top,
  ),
  d.vec4f(
    -1,
    1,
    0,
    GUMMY_BOARD_SLAB.halfExtent - GUMMY_BOARD_SLAB.bevel + GUMMY_BOARD_GRID.top,
  ),
  d.vec4f(
    0,
    1,
    1,
    GUMMY_BOARD_SLAB.halfExtent - GUMMY_BOARD_SLAB.bevel + GUMMY_BOARD_GRID.top,
  ),
  d.vec4f(
    0,
    1,
    -1,
    GUMMY_BOARD_SLAB.halfExtent - GUMMY_BOARD_SLAB.bevel + GUMMY_BOARD_GRID.top,
  ),
])
/** Exact convex clipping avoids a per-pixel ray-march and handles parallel/inside rays. */
export const gummyBoardBevelHit = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec4f,
)((origin, ray) => {
  'use gpu'
  let near = d.f32(-1e20)
  let far = d.f32(1e20)
  let entryNormal = d.vec3f(0)
  let exitNormal = d.vec3f(0)
  for (let index = d.u32(0); index < 10; index++) {
    const plane = slabPlanes.$[index]!
    const speed = std.dot(plane.xyz, ray)
    const gap = plane.w - std.dot(plane.xyz, origin)
    if (std.abs(speed) < 1e-6) {
      if (gap < 0) return d.vec4f(0, 0, 0, -1)
    } else {
      const distance = gap / speed
      if (speed < 0 && distance > near) {
        near = distance
        entryNormal = std.normalize(plane.xyz)
      } else if (speed > 0 && distance < far) {
        far = distance
        exitNormal = std.normalize(plane.xyz)
      }
      if (near > far) return d.vec4f(0, 0, 0, -1)
    }
  }
  if (far < 0) return d.vec4f(0, 0, 0, -1)
  if (near >= 0) return d.vec4f(entryNormal, near)
  return d.vec4f(exitNormal, far)
})

/** Four small graphite feet make the air gap visible without changing the playable surface. */
export const gummyBoardGlassSupportHit = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec4f,
)((origin, ray) => {
  'use gpu'
  let nearest = d.vec4f(0, 0, 0, -1)
  for (let index = d.u32(0); index < 4; index++) {
    const centre = d.vec2f(
      d.f32(index % 2) * 11.8 - 5.9,
      d.f32(d.u32(index / 2)) * 11.8 - 5.9,
    )
    const hit = gummyBoxHit(
      origin,
      ray,
      d.vec3f(centre.x - 0.19, GUMMY_BOARD_GLASS_FLOOR, centre.y - 0.19),
      d.vec3f(centre.x + 0.19, GUMMY_BOARD_SLAB.bottom, centre.y + 0.19),
    )
    if (hit.w >= 0 && (nearest.w < 0 || hit.w < nearest.w))
      nearest = d.vec4f(hit)
  }
  return nearest
})
export const gummyBoardGlassSupportMaterial = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((normal, ray) => {
  'use gpu'
  const diffuse =
    0.6 +
    0.4 * std.max(std.dot(normal, std.normalize(d.vec3f(-0.42, 0.87, 0.26))), 0)
  return std.add(
    std.mul(d.vec3f(0.027, 0.033, 0.035), diffuse),
    std.mul(gummyEnvironment(std.reflect(ray, normal)), 0.012),
  )
})

/** Smooth cast surface shared by camera rays and area-averaged transmitted light. */
export const gummyBoardGlassCastNormal = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((point, normal) => {
  'use gpu'
  if (normal.y < 0.99) return d.vec3f(normal)
  const grain = perlin2d.sampleWithGradient(
    std.add(std.mul(point.xz, 1.15), d.vec2f(4.7, 8.3)),
  )
  return std.normalize(
    std.add(normal, d.vec3f(grain.y * 0.008, 0, grain.z * 0.008)),
  )
})

/** Etched micro-bevels remain sharp in reflections; their transmitted pattern
 * averages out beneath the frosted insets and broad studio lights. */
export const gummyBoardGlassNormal = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((point, normal) => {
  'use gpu'
  const cast = gummyBoardGlassCastNormal(point, normal)
  if (normal.y < 0.99) return cast
  const inset = gummyBoardGlassInset(point.xz)
  return std.normalize(std.add(cast, d.vec3f(inset.bevel.x, 0, inset.bevel.y)))
})
