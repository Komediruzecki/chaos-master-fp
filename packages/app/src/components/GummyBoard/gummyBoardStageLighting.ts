/** Chess square colour and studio illumination response. */
import { d, std, tgpu } from 'typegpu'
import { gummyBoardSquareParity } from './gummyBoardGridShaders'

export const gummyBoardSquareColour = tgpu.fn(
  [d.vec2f],
  d.vec3f,
)((point) => {
  'use gpu'
  return std.mix(
    d.vec3f(0.76, 0.71, 0.61),
    d.vec3f(0.12, 0.19, 0.2),
    gummyBoardSquareParity(point),
  )
})

export const gummyBoardTileColour = tgpu.fn(
  [d.vec2f, d.f32],
  d.vec3f,
)((point, theme) => {
  'use gpu'
  const alternate = gummyBoardSquareParity(point)
  if (theme < 0.5) return gummyBoardSquareColour(point)
  if (theme < 1.5)
    return std.mix(
      d.vec3f(0.3, 0.34, 0.3),
      d.vec3f(0.027, 0.075, 0.075),
      alternate,
    )
  return std.mix(
    d.vec3f(0.3, 0.16, 0.075),
    d.vec3f(0.033, 0.043, 0.048),
    alternate,
  )
})

/** A quiet studio sweep falls away from the board rather than filling the frame with flat grey. */
export const gummyBoardStudioFloor = tgpu.fn(
  [d.vec3f, d.f32],
  d.vec3f,
)((point, theme) => {
  'use gpu'
  const pool = std.exp(-std.dot(point.xz, point.xz) / 150)
  if (theme < 1.5)
    return std.mix(
      d.vec3f(0.012, 0.017, 0.018),
      d.vec3f(0.039, 0.048, 0.047),
      pool,
    )
  return std.mix(d.vec3f(0.014, 0.011, 0.01), d.vec3f(0.043, 0.03, 0.021), pool)
})

/** Preserve caustic hue under bright overlap and retain enough contact shadow to seat each base. */
export const gummyBoardStageLighting = tgpu.fn(
  [d.vec3f, d.vec4f, d.f32],
  d.vec3f,
)((base, light, theme) => {
  'use gpu'
  if (theme < 0.5)
    return std.add(
      std.mul(base, 1 - std.clamp(light.w, 0, 0.45)),
      std.min(light.xyz, d.vec3f(0.7)),
    )
  const incident = std.mul(std.max(light.xyz, d.vec3f(0)), 0.32)
  const peak = std.max(incident.x, std.max(incident.y, incident.z))
  const caustic = std.div(incident, 1 + peak / 0.2)
  return std.add(std.mul(base, 1 - std.clamp(light.w * 1.55, 0, 0.62)), caustic)
})
