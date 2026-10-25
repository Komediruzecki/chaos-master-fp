/**
 * Linear-light dielectric optics and an authored studio illumination field.
 * Fresnel/absorption follow Filament and KHR_materials_ior/volume; softboxes
 * approximate an environment, not traced geometry or a measured HDR panorama.
 */
import { d, std, tgpu } from 'typegpu'

export const GLASS_IOR = 1.5
export const GLASS_WALL_THICKNESS = 0.018

export const dielectricF0 = tgpu.fn(
  [d.f32],
  d.f32,
)((ior) => {
  'use gpu'
  const ratio = (ior - 1) / (ior + 1)
  return ratio * ratio
})

/** Schlick approximates the unpolarized dielectric interface reflectance. */
export const dielectricFresnel = tgpu.fn(
  [d.f32, d.f32],
  d.f32,
)((cosine, ior) => {
  'use gpu'
  const f0 = dielectricF0(ior)
  return f0 + (1 - f0) * std.pow(1 - std.clamp(cosine, 0, 1), 5)
})

/** Attenuation colour is the remaining linear light after attenuationDistance. */
export const glassAttenuation = tgpu.fn(
  [d.vec3f, d.f32, d.f32],
  d.vec3f,
)((colour, distance, path) => {
  'use gpu'
  const coefficient = std.div(
    std.neg(std.log(std.clamp(colour, d.vec3f(0.001), d.vec3f(1)))),
    std.max(distance, 0.001),
  )
  return std.exp(std.mul(coefficient, -std.max(path, 0)))
})

/** Finite angular rectangle with feathered edges, evaluated in world space. */
const softbox = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec2f, d.f32],
  d.f32,
)((direction, centre, size, roughness) => {
  'use gpu'
  const forward = std.normalize(centre)
  const right = std.normalize(std.cross(forward, d.vec3f(0, 1, 0)))
  const up = std.cross(right, forward)
  const facing = std.dot(direction, forward)
  const coordinate = std.div(
    d.vec2f(std.dot(direction, right), std.dot(direction, up)),
    std.max(facing, 0.001),
  )
  const softness = std.add(
    std.mul(size, d.vec2f(0.28, 0.18)),
    d.vec2f(0.018 + roughness * 0.4),
  )
  const extent = std.abs(coordinate)
  const x =
    1 - std.smoothstep(size.x - softness.x, size.x + softness.x, extent.x)
  const y =
    1 - std.smoothstep(size.y - softness.y, size.y + softness.y, extent.y)
  return x * y * std.smoothstep(0, 0.05, facing)
})

/** Polished-glass reflections use achromatic cards, with a restrained cool fill. */
export const studioEnvironment = tgpu.fn(
  [d.vec3f, d.f32],
  d.vec3f,
)((direction, roughness) => {
  'use gpu'
  const sky = std.smoothstep(-0.12, 0.7, direction.y)
  let radiance = std.mix(
    d.vec3f(0.012, 0.018, 0.027),
    d.vec3f(0.075, 0.09, 0.12),
    sky,
  )
  const key = softbox(
    direction,
    d.vec3f(-0.58, 0.64, 0.48),
    d.vec2f(0.17, 0.75),
    roughness,
  )
  const strip = softbox(
    direction,
    d.vec3f(0.76, 0.25, -0.46),
    d.vec2f(0.06, 1.15),
    roughness,
  )
  const ceiling = softbox(
    direction,
    d.vec3f(0.06, 0.95, -0.28),
    d.vec2f(0.48, 0.36),
    roughness,
  )
  radiance = std.add(radiance, std.mul(d.vec3f(5.6, 5.4, 5.2), key))
  radiance = std.add(radiance, std.mul(d.vec3f(2.7, 3, 3.5), strip))
  return std.add(radiance, std.mul(d.vec3f(1.5, 1.7, 2), ceiling))
})

/** Cook–Torrance GGX with Smith correlated visibility for the polished board. */
export const boardSpecular = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.f32],
  d.f32,
)((normal, view, light, roughness) => {
  'use gpu'
  const half = std.normalize(std.add(view, light))
  const noV = std.max(std.dot(normal, view), 0.001)
  const noL = std.max(std.dot(normal, light), 0.001)
  const noH = std.max(std.dot(normal, half), 0)
  const voH = std.max(std.dot(view, half), 0)
  const alpha = roughness * roughness
  const a2 = alpha * alpha
  const denominator = noH * noH * (a2 - 1) + 1
  const distribution = a2 / (Math.PI * denominator * denominator)
  const gv = noL * std.sqrt(noV * noV * (1 - a2) + a2)
  const gl = noV * std.sqrt(noL * noL * (1 - a2) + a2)
  const visibility = 0.5 / std.max(gv + gl, 0.001)
  return distribution * visibility * dielectricFresnel(voH, 1.5) * noL
})

const srgbChannel = tgpu.fn(
  [d.f32],
  d.f32,
)((linear) => {
  'use gpu'
  if (linear <= 0.0031308) return linear * 12.92
  return 1.055 * std.pow(linear, 1 / 2.4) - 0.055
})

/** One fitted filmic shoulder followed by the exact sRGB display transfer. */
export const displayColour = tgpu.fn(
  [d.vec3f, d.f32],
  d.vec3f,
)((hdr, encodeSrgb) => {
  'use gpu'
  const colour = std.max(hdr, d.vec3f(0))
  const numerator = std.mul(
    colour,
    std.add(std.mul(colour, 2.51), d.vec3f(0.03)),
  )
  const denominator = std.add(
    std.mul(colour, std.add(std.mul(colour, 2.43), d.vec3f(0.59))),
    d.vec3f(0.14),
  )
  const mapped = std.clamp(
    std.div(numerator, denominator),
    d.vec3f(0),
    d.vec3f(1),
  )
  if (encodeSrgb > 0.5)
    return d.vec3f(
      srgbChannel(mapped.x),
      srgbChannel(mapped.y),
      srgbChannel(mapped.z),
    )
  return mapped
})
