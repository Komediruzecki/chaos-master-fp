// Narrow material signatures select local surface detail without changing exported factors.
import { d, std, tgpu } from 'typegpu'

/** 0 smooth/other, 1 black paper, 2 tobacco leather, 3 gilding. Shared CPU/GPU function. */
export const bookSurfaceKind = tgpu.fn(
  [d.vec3f, d.vec4f],
  d.u32,
)((base, surface) => {
  'use gpu'
  if (
    surface.x < 0.01 &&
    std.distance(base, d.vec3f(0.03, 0.029, 0.032)) < 0.002 &&
    std.abs(surface.y - 0.86) < 0.01
  )
    return d.u32(1)
  if (
    surface.x < 0.01 &&
    std.distance(base, d.vec3f(0.03, 0.022, 0.018)) < 0.002 &&
    std.abs(surface.y - 0.58) < 0.01
  )
    return d.u32(2)
  if (
    surface.x > 0.99 &&
    base.x > 0.94 &&
    base.y > 0.7 &&
    base.y < 0.8 &&
    base.z < 0.45
  )
    return d.u32(3)
  return d.u32(0)
})
