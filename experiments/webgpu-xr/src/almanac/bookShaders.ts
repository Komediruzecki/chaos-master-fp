// Factor-material lighting for the authored book, sharing the flame HDR/depth pass.
import { d, std, tgpu } from 'typegpu'
import { View } from '../bench/shaders'

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
  let rough = std.clamp(input.surface.y, 0.18, 0.98)
  const clay = camera.eye.w > 0.5
  if (clay) {
    albedo = d.vec3f(0.32, 0.34, 0.36)
    metal = d.f32(0)
    rough = d.f32(0.75)
  }
  // Small material variation, filtered by pixel footprint to avoid distant shimmer.
  const grainCoordinates = input.world.mul(190)
  const footprint = std.max(
    std.length(std.dpdx(grainCoordinates)),
    std.length(std.dpdy(grainCoordinates)),
  )
  const grain =
    std.sin(grainCoordinates.x * 1.9 + std.sin(grainCoordinates.z * 2.7)) *
    std.sin(grainCoordinates.z * 1.3 + grainCoordinates.y)
  const grainWeight =
    (1 - std.smoothstep(0.3, 1.7, footprint)) * (1 - metal) * 0.07
  albedo = albedo.mul(1 + grain * grainWeight)
  const hemisphere = 0.045 + 0.07 * std.max(d.f32(0), normal.y)
  let color = albedo
    .mul(d.vec3f(0.55, 0.7, 0.93))
    .mul(hemisphere * (1 - metal * 0.6))
  color = color.add(
    illuminate(
      normal,
      toEye,
      std.normalize(d.vec3f(-0.65, 0.42, 0.6)),
      albedo,
      metal,
      rough,
      input.surface.w,
      d.vec3f(2.9, 2.15, 1.6),
    ),
  )
  color = color.add(
    illuminate(
      normal,
      toEye,
      std.normalize(d.vec3f(0.6, 0.65, -0.6)),
      albedo,
      metal,
      rough,
      input.surface.w,
      d.vec3f(0.3, 0.68, 1.1),
    ),
  )
  // Broad analytic studio reflection keeps rough gold legible without an IBL map.
  const reflected = std.reflect(toEye.mul(-1), normal)
  const warmReflection =
    0.09 +
    0.42 *
      std.pow(
        std.max(
          d.f32(0),
          std.dot(reflected, std.normalize(d.vec3f(-0.4, 0.8, 0.4))),
        ),
        3,
      )
  color = color.add(
    albedo.mul(d.vec3f(1, 0.8, 0.5)).mul(metal * warmReflection),
  )
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
        d.vec3f(0.2, 2.3, 3.1).mul(leftGlow),
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
        d.vec3f(1.1, 1.9, 1.55).mul(rightGlow),
      ),
    )
    color = color.add(albedo.mul(input.surface.z))
  }
  return d.vec4f(color, 1)
})
