// Faceted translucent crystal and delayed glints: Fresnel/alpha approximation without refraction.
import { d, std, tgpu } from 'typegpu'
import { View } from '../bench/shaders'
import { GLASSWAKE_VERTICES_PER_SHARD } from './glasswakeGeometry'

export const GlasswakeVertex = d.struct({
  position: d.vec4f,
  normal: d.vec4f,
  barycentric: d.vec4f,
})
export const GlasswakeInstance = d.struct({
  matrix: d.mat4x4f,
  tint: d.vec4f,
  effect: d.vec4f,
})
export const glasswakeLayout = tgpu.bindGroupLayout({
  camera: { uniform: View },
  vertices: { storage: d.arrayOf(GlasswakeVertex) },
  instances: { storage: d.arrayOf(GlasswakeInstance) },
})

export const glasswakeVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: {
    position: d.builtin.position,
    world: d.vec3f,
    normal: d.vec3f,
    barycentric: d.vec3f,
    tint: d.vec4f,
    effect: d.vec4f,
    cut: d.f32,
  },
})((input) => {
  'use gpu'
  const instance = glasswakeLayout.$.instances[input.instance]
  const vertex =
    glasswakeLayout.$.vertices[
      d.u32(instance.effect.w) * GLASSWAKE_VERTICES_PER_SHARD + input.vertex
    ]
  const world = std.mul(instance.matrix, vertex.position)
  return {
    position: std.mul(
      glasswakeLayout.$.camera.projection,
      std.mul(glasswakeLayout.$.camera.view, world),
    ),
    world: world.xyz,
    normal: std.normalize(
      std.mul(instance.matrix, d.vec4f(vertex.normal.xyz, 0)).xyz,
    ),
    barycentric: vertex.barycentric.xyz,
    tint: instance.tint,
    effect: instance.effect,
    cut: vertex.normal.w,
  }
})

export const glasswakeFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    normal: d.vec3f,
    barycentric: d.vec3f,
    tint: d.vec4f,
    effect: d.vec4f,
    cut: d.f32,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const normal = std.normalize(input.normal)
  const toEye = std.normalize(glasswakeLayout.$.camera.eye.xyz.sub(input.world))
  const facing = std.clamp(std.dot(normal, toEye), 0, 1)
  const fresnel = std.pow(1 - facing, 3)
  const derivatives = std.max(std.fwidth(input.barycentric), d.vec3f(0.0001))
  const interior = std.smoothstep(
    derivatives.mul(0.35),
    derivatives.mul(1.25 + input.effect.y),
    input.barycentric,
  )
  const edge = 1 - std.min(interior.x, std.min(interior.y, interior.z))
  const warmHalf = std.normalize(
    toEye.add(std.normalize(d.vec3f(-0.55, 0.8, 0.8))),
  )
  const coolHalf = std.normalize(
    toEye.add(std.normalize(d.vec3f(0.8, 0.2, -0.3))),
  )
  const warm = std.pow(std.max(d.f32(0), std.dot(normal, warmHalf)), 86)
  const cool = std.pow(std.max(d.f32(0), std.dot(normal, coolHalf)), 48)
  const crack = edge * (0.1 + input.effect.y * 1.8)
  let color = input.tint.rgb
    .mul(0.11 + fresnel * 0.7 + input.cut * 0.09)
    .add(d.vec3f(1, 0.93, 0.76).mul(warm * 2.8))
    .add(d.vec3f(0.65, 0.88, 1).mul(cool * 1.2))
    .add(input.tint.rgb.mul(crack))
  let opacity =
    std.clamp(
      0.13 +
        fresnel * 0.48 +
        input.cut * 0.07 +
        edge * 0.08 +
        input.effect.y * 0.06,
      0,
      0.78,
    ) * input.effect.x
  if (input.tint.w > 0.5) {
    color = d
      .vec3f(0.32, 0.35, 0.38)
      .mul(
        0.3 +
          std.max(
            d.f32(0),
            std.dot(normal, std.normalize(d.vec3f(-0.4, 0.8, 0.6))),
          ),
      )
    opacity = input.effect.x
  }
  // Premultiplied alpha composites the existing HDR scene; no scene-color sampling/refraction.
  return d.vec4f(color.mul(opacity), opacity)
})

const corners = tgpu.const(d.arrayOf(d.vec2f, 6), [
  d.vec2f(-1, -1),
  d.vec2f(1, -1),
  d.vec2f(-1, 1),
  d.vec2f(-1, 1),
  d.vec2f(1, -1),
  d.vec2f(1, 1),
])

export const glasswakeGlitterVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: { position: d.builtin.position, uv: d.vec2f, color: d.vec3f },
})((input) => {
  'use gpu'
  const instance = glasswakeLayout.$.instances[input.instance]
  const age = instance.effect.z
  const id = instance.effect.w
  const envelope =
    std.smoothstep(0.22, 0.42, age) * (1 - std.smoothstep(0.95, 1.4, age))
  const flash =
    0.12 + std.pow(0.5 + 0.5 * std.sin(age * 37 + id * 4.1), 12) * 2.4
  const world = std
    .mul(instance.matrix, d.vec4f(0, 0, 0, 1))
    .add(
      d.vec4f(
        std.sin(id * 2.4) * age * 0.07,
        std.cos(id * 3.1) * age * 0.07,
        0,
        0,
      ),
    )
  const center = std.mul(glasswakeLayout.$.camera.view, world)
  const uv = corners.$[input.vertex]
  const size = 0.012 + (0.5 + 0.5 * std.sin(id * 7.3)) * 0.014
  return {
    position: std.mul(
      glasswakeLayout.$.camera.projection,
      center.add(d.vec4f(uv.mul(size), 0, 0)),
    ),
    uv: d.vec2f(uv),
    color: std.mix(instance.tint.rgb, d.vec3f(1), 0.65).mul(envelope * flash),
  }
})

export const glasswakeGlitterFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f, color: d.vec3f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const axes = std.max(d.vec2f(0), d.vec2f(1).sub(std.abs(input.uv)))
  const star =
    std.exp(-18 * std.dot(input.uv, input.uv)) +
    (std.pow(axes.x, 20) * axes.y + std.pow(axes.y, 20) * axes.x) * 0.35
  return d.vec4f(input.color.mul(star), 0)
})
