/** Fused gummy dye bands in immutable rest coordinates, including mixed-volume absorption. */
import { d, std, tgpu } from 'typegpu'
import { gummyTransmission } from './gummyMaterial'

/** Palette mode 0 keeps the authored solid; 1 is Candy and 2 is Lagoon. */
const gummyBands = tgpu.fn(
  [d.f32, d.f32, d.vec3f, d.vec3f, d.vec3f, d.vec3f],
  d.vec3f,
)((height, mode, feet, body, head, cap) => {
  'use gpu'
  const torso = std.smoothstep(0.61, 0.77, height)
  let result = std.mix(feet, body, torso)
  if (mode < 1.5) {
    result = std.mix(result, head, std.smoothstep(1.53, 1.67, height))
    return std.mix(result, cap, std.smoothstep(2.03, 2.15, height))
  }
  return std.mix(result, head, std.smoothstep(1.59, 1.75, height))
})

export const gummyAbsorptionAtRest = tgpu.fn(
  [d.f32, d.f32, d.vec3f],
  d.vec3f,
)((height, mode, solid) => {
  'use gpu'
  if (mode < 0.5) return d.vec3f(solid)
  if (mode < 1.5)
    return gummyBands(
      height,
      mode,
      d.vec3f(0.12, 0.8, 3.5),
      d.vec3f(2.8, 0.25, 3.5),
      d.vec3f(0.25, 3.8, 1.15),
      d.vec3f(2.1, 6, 3.8),
    )
  return gummyBands(
    height,
    mode,
    d.vec3f(0.12, 0.8, 3.5),
    d.vec3f(4.8, 0.38, 0.5),
    d.vec3f(6.2, 2.55, 0.25),
    d.vec3f(6.2, 2.55, 0.25),
  )
})

export const gummyColourAtRest = tgpu.fn(
  [d.f32, d.f32, d.vec3f],
  d.vec3f,
)((height, mode, solid) => {
  'use gpu'
  if (mode < 0.5) return d.vec3f(solid)
  if (mode < 1.5)
    return gummyBands(
      height,
      mode,
      d.vec3f(0.85, 0.27, 0.025),
      d.vec3f(0.12, 0.65, 0.035),
      d.vec3f(0.9, 0.04, 0.26),
      d.vec3f(0.35, 0.006, 0.055),
    )
  return gummyBands(
    height,
    mode,
    d.vec3f(0.85, 0.27, 0.025),
    d.vec3f(0.01, 0.65, 0.54),
    d.vec3f(0.008, 0.08, 0.55),
    d.vec3f(0.008, 0.08, 0.55),
  )
})

/** A fused 3D rest-space pattern: berry/amber bulk crossed by a curved turquoise ribbon. */
export const gummyMarbleWeights = tgpu.fn(
  [d.vec3f],
  d.vec3f,
)((point) => {
  'use gpu'
  const warped =
    point.y +
    0.3 * std.sin(2.8 * point.x + 1.1 * point.z) +
    0.14 * std.sin(5.4 * point.z - 2.1 * point.x + 1.6 * point.y)
  const amber = std.smoothstep(
    0.28,
    0.72,
    0.5 + 0.5 * std.sin(2.6 * warped + 0.4),
  )
  const ribbon = 1 - std.smoothstep(0.14, 0.25, std.abs(warped - 1.12))
  return d.vec3f(amber * (1 - ribbon), (1 - amber) * (1 - ribbon), ribbon)
})

const gummyMarbleMix = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f],
  d.vec3f,
)((weights, amber, berry, turquoise) => {
  'use gpu'
  return std.add(
    std.add(std.mul(amber, weights.x), std.mul(berry, weights.y)),
    std.mul(turquoise, weights.z),
  )
})

export const gummyAbsorptionAtPoint = tgpu.fn(
  [d.vec3f, d.f32, d.vec3f],
  d.vec3f,
)((point, mode, solid) => {
  'use gpu'
  if (mode < 2.5) return gummyAbsorptionAtRest(point.y, mode, solid)
  return gummyMarbleMix(
    gummyMarbleWeights(point),
    d.vec3f(0.18, 1.9, 5.6),
    d.vec3f(1.15, 6.5, 5.7),
    d.vec3f(5.8, 1.3, 1.6),
  )
})

export const gummyColourAtPoint = tgpu.fn(
  [d.vec3f, d.f32, d.vec3f],
  d.vec3f,
)((point, mode, solid) => {
  'use gpu'
  if (mode < 2.5) return gummyColourAtRest(point.y, mode, solid)
  return gummyMarbleMix(
    gummyMarbleWeights(point),
    d.vec3f(0.7, 0.13, 0.008),
    d.vec3f(0.3, 0.0015, 0.007),
    d.vec3f(0.004, 0.24, 0.18),
  )
})

/** Six midpoint samples approximate a bent optical path by its rest-space endpoint segment. */
export const gummyVolumeTransmission = tgpu.fn(
  [d.vec3f, d.vec3f, d.f32, d.f32, d.vec3f],
  d.vec3f,
)((enter, exit, path, mode, solid) => {
  'use gpu'
  if (mode < 0.5) return gummyTransmission(solid, path)
  let absorption = d.vec3f(0)
  for (let i = d.u32(0); i < 6; i++) {
    const t = (d.f32(i) + 0.5) / 6
    const point = std.mix(enter, exit, t)
    absorption = std.add(absorption, gummyAbsorptionAtPoint(point, mode, solid))
  }
  return gummyTransmission(std.div(absorption, 6), path)
})
