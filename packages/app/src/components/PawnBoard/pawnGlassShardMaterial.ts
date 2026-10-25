/** Restrained thin-chip optics for alpha-composited glass fragments. */
import { d, std, tgpu } from 'typegpu'
import { dielectricFresnel, GLASS_IOR, studioEnvironment, } from './pawnGlassMaterial'

/**
 * Alpha compositing approximates transmission through tiny moving chips. Broad,
 * compressed reflections keep overlapping walls from becoming an opaque flash;
 * unlike the intact shell this does not trace a refracted scene sample.
 */
export const glassShardColour = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.f32],
  d.vec4f,
)((normal, view, tint, fade) => {
  'use gpu'
  const light = std.normalize(d.vec3f(-0.45, 0.9, 0.4))
  const noV = std.abs(std.dot(normal, view))
  const fresnel = dielectricFresnel(noV, GLASS_IOR)
  const reflected = std.reflect(std.neg(view), normal)
  const environment = studioEnvironment(reflected, 0.22)
  const reflection = std.div(environment, std.add(d.vec3f(1), environment))
  const diffuse = std.abs(std.dot(normal, light))
  const halfVector = std.add(light, view)
  const halfDirection = std.div(
    halfVector,
    std.max(std.length(halfVector), 0.001),
  )
  const glint = std.pow(std.abs(std.dot(normal, halfDirection)), 12)
  const body = std.mul(
    std.clamp(tint, d.vec3f(0), d.vec3f(1)),
    0.06 + 0.1 * diffuse,
  )
  const colour = std.add(
    std.add(body, std.mul(reflection, 0.52)),
    std.mul(d.vec3f(0.95, 0.98, 1), glint * 0.07),
  )
  // A front-facing chip leaves over 90% of the scene visible. Rims remain
  // legible, but never accumulate the old 88%-opaque impact whitening.
  const coverage =
    (0.075 + 0.28 * fresnel + 0.04 * glint) * std.clamp(fade, 0, 1)
  return d.vec4f(colour, coverage)
})
