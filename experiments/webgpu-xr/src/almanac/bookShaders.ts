// Authored factor materials with filtered local grain and analytic studio reflections.
import { d, std, tgpu } from 'typegpu'
import { View } from '../bench/shaders'
import { bookSurfaceKind } from './bookSurface'

export const BookVertex = d.struct({
  position: d.vec4f,
  normal: d.vec4f,
  color: d.vec4f,
  surface: d.vec4f,
})
export const bookVertexLayout = tgpu.vertexLayout(d.arrayOf(BookVertex))
export const bookLayout = tgpu.bindGroupLayout({ camera: { uniform: View } })

export const bookVertex = tgpu.vertexFn({
  in: { position: d.vec4f, normal: d.vec4f, color: d.vec4f, surface: d.vec4f },
  out: {
    position: d.builtin.position,
    world: d.vec3f,
    local: d.vec3f,
    normal: d.vec3f,
    color: d.vec4f,
    surface: d.vec4f,
  },
})((input) => {
  'use gpu'
  return {
    position: std.mul(
      bookLayout.$.camera.projection,
      std.mul(bookLayout.$.camera.view, input.position),
    ),
    world: input.position.xyz,
    local: input.position.xyz,
    normal: input.normal.xyz,
    color: input.color,
    surface: input.surface,
  }
})

// A compact metal/roughness response with analytic studio lights. No IBL or texture claims.
const illuminate = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32, d.f32, d.vec3f],
  d.vec3f,
)((normal, toEye, light, albedo, metal, rough, specularWeight, radiance) => {
  'use gpu'
  const h = std.normalize(light.add(toEye))
  const nl = std.max(0.001, std.dot(normal, light))
  const nv = std.max(0.001, std.dot(normal, toEye))
  const nh = std.max(d.f32(0), std.dot(normal, h))
  const vh = std.max(d.f32(0), std.dot(toEye, h))
  const a = rough * rough
  const a2 = a * a
  const denominator = nh * nh * (a2 - 1) + 1
  const distribution = a2 / (Math.PI * denominator * denominator)
  const k = ((rough + 1) * (rough + 1)) / 8
  const visibility = (nl / (nl * (1 - k) + k)) * (nv / (nv * (1 - k) + k))
  const f0 = std.mix(d.vec3f(0.04 * specularWeight), albedo, metal)
  const fresnel = f0.add(
    d
      .vec3f(1)
      .sub(f0)
      .mul(std.pow(1 - vh, 5)),
  )
  const specular = fresnel.mul(
    (distribution * visibility) / (4 * nl * nv + 0.001),
  )
  const diffuse = albedo.mul((1 - metal) / Math.PI)
  return diffuse.add(specular).mul(radiance).mul(nl)
})

export const bookFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    local: d.vec3f,
    normal: d.vec3f,
    color: d.vec4f,
    surface: d.vec4f,
    front: d.builtin.frontFacing,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const camera = bookLayout.$.camera
  let normal = std.normalize(input.normal)
  if (!input.front) normal = normal.mul(-1)
  const toEye = std.normalize(camera.eye.xyz.sub(input.world))
  let albedo = d.vec3f(input.color.rgb)
  let metal = input.surface.x
  let rough = std.clamp(input.surface.y, 0.08, 0.98)
  const clay = camera.eye.w > 0.5
  const kind = bookSurfaceKind(input.color.rgb, input.surface)
  // Model-local coordinates keep grain fixed on the book in either scene.
  const local = input.local
  const pixelSize = std.max(
    std.length(std.dpdx(local)),
    std.length(std.dpdy(local)),
  )
  const fineWeight = 1 - std.smoothstep(0.0003, 0.0006, pixelSize)
  const broadWeight = 1 - std.smoothstep(0.006, 0.012, pixelSize)
  const fibers = std.sin(local.x * 5235.99 + std.sin(local.z * 3100))
  const bands = std.sin(local.z * 261.8 + std.sin(local.x * 71) * 0.5)
  if (kind === 1) {
    const grain = fibers * fineWeight * 0.55 + bands * broadWeight * 0.45
    albedo = albedo.mul(1 + grain * 0.04)
    rough = std.clamp(rough + grain * 0.06, 0.08, 0.98)
    // The binding is centred on local X=0 in both exported GLBs and scene instances.
    albedo = albedo.mul(
      std.mix(0.55, 1, std.smoothstep(0, 0.03, std.abs(local.x))),
    )
  } else if (kind === 2) {
    const pebbles = std.sin(local.x * 4188.79) * std.sin(local.z * 4188.79)
    const weight = 1 - std.smoothstep(0.000375, 0.00075, pixelSize)
    albedo = albedo.mul(1 + pebbles * weight * 0.05)
    rough = std.clamp(rough + pebbles * weight * 0.065, 0.08, 0.98)
  } else if (kind === 3) {
    const burnish = std.sin(local.x * 785.4 + std.sin(local.z * 440))
    const weight = 1 - std.smoothstep(0.002, 0.004, pixelSize)
    rough = std.clamp(rough + burnish * weight * 0.045, 0.08, 0.98)
  }
  if (clay) {
    albedo = d.vec3f(0.32, 0.34, 0.36)
    metal = d.f32(0)
    rough = d.f32(0.75)
  }
  const hemisphere = std.mix(
    d.vec3f(0.075, 0.062, 0.05),
    d.vec3f(0.19, 0.21, 0.25),
    normal.y * 0.5 + 0.5,
  )
  let color = albedo.mul(hemisphere).mul(1 - metal * 0.8)
  color = color.add(
    illuminate(
      normal,
      toEye,
      std.normalize(d.vec3f(-0.62, 0.62, 0.48)),
      albedo,
      metal,
      rough,
      input.surface.w,
      d.vec3f(3.7, 3.219, 2.664),
    ),
  )
  color = color.add(
    illuminate(
      normal,
      toEye,
      std.normalize(d.vec3f(0.7, 0.45, 0.3)),
      albedo,
      metal,
      rough,
      input.surface.w,
      d.vec3f(0.47, 0.58, 0.666),
    ),
  )
  color = color.add(
    illuminate(
      normal,
      toEye,
      std.normalize(d.vec3f(0.15, 0.82, -0.57)),
      albedo,
      metal,
      rough,
      input.surface.w,
      d.vec3f(1.1, 1.2, 1.295),
    ),
  )
  // Formula-based softboxes, not an environment texture. Rough surfaces broaden the lobes.
  const reflected = std.reflect(toEye.mul(-1), normal)
  const spread = rough * rough
  const warmBox = std.pow(
    std.max(
      d.f32(0),
      std.dot(reflected, std.normalize(d.vec3f(-0.4, 0.85, 0.35))),
    ),
    std.mix(72, 3, spread),
  )
  const coolStrip = std.pow(
    std.max(
      d.f32(0),
      std.dot(reflected, std.normalize(d.vec3f(0.85, 0.5, -0.1))),
    ),
    std.mix(140, 5, spread),
  )
  const environment = d
    .vec3f(std.mix(0.01, 0.04, reflected.y * 0.5 + 0.5))
    .add(d.vec3f(1, 0.87, 0.72).mul(warmBox * (1.1 - spread * 0.6)))
    .add(d.vec3f(0.65, 0.78, 1).mul(coolStrip * (0.75 - spread * 0.4)))
  const f0 = std.mix(d.vec3f(0.04 * input.surface.w), albedo, metal)
  const fresnel = f0.add(
    d
      .vec3f(1)
      .sub(f0)
      .mul(std.pow(1 - std.clamp(std.dot(normal, toEye), 0, 1), 5)),
  )
  color = color.add(environment.mul(fresnel))
  if (!clay) {
    const leftDelta = camera.leftDock.xyz.sub(input.world)
    const rightDelta = camera.rightDock.xyz.sub(input.world)
    const leftGlow = 0.035 / (0.1 + std.dot(leftDelta, leftDelta))
    const rightGlow = 0.03 / (0.1 + std.dot(rightDelta, rightDelta))
    color = color.add(
      illuminate(
        normal,
        toEye,
        std.normalize(leftDelta),
        albedo,
        metal,
        rough,
        input.surface.w,
        d.vec3f(2.4, 1.65, 0.65).mul(leftGlow),
      ),
    )
    color = color.add(
      illuminate(
        normal,
        toEye,
        std.normalize(rightDelta),
        albedo,
        metal,
        rough,
        input.surface.w,
        d.vec3f(0.4, 1.9, 1.4).mul(rightGlow),
      ),
    )
    color = color.add(albedo.mul(input.surface.z))
  }
  return d.vec4f(color, 1)
})
