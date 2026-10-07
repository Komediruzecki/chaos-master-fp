/** Broad reflection cards give the sculpted candy readable soft highlights without changing legacy optics. */
import { d, std, tgpu } from 'typegpu'
import { lightCard } from '../GummyBear/gummyMaterial'

// Art-directed studio environment, not an area-light transport or reflection of scene geometry.
export const gummyCinemaEnvironment = tgpu.fn(
  [d.vec3f],
  d.vec3f,
)((direction) => {
  'use gpu'
  const sky = std.smoothstep(-0.2, 0.85, direction.y)
  let light = std.mix(
    d.vec3f(0.075, 0.065, 0.055),
    d.vec3f(0.15, 0.19, 0.24),
    sky,
  )
  light = std.add(
    light,
    std.mul(
      d.vec3f(4.2, 3.95, 3.5),
      lightCard(direction, d.vec3f(-0.55, 0.62, 0.55), d.vec2f(0.23, 0.58)),
    ),
  )
  light = std.add(
    light,
    std.mul(
      d.vec3f(2.85, 3.5, 4.25),
      lightCard(direction, d.vec3f(0.76, 0.33, -0.52), d.vec2f(0.08, 0.72)),
    ),
  )
  return std.add(
    light,
    std.mul(
      d.vec3f(1.45, 1.4, 1.35),
      lightCard(direction, d.vec3f(-0.1, 0.92, -0.3), d.vec2f(0.3, 0.24)),
    ),
  )
})
