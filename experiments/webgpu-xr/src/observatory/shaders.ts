// Model transforms, retained-point motion and a camera-correct procedural sky.
import { d, std, tgpu } from 'typegpu'
import { bookLayout } from '../almanac/bookShaders'
import { worldPoint } from '../almanac/worldComposition'
import { resolveLayout, sceneLayout } from '../bench/shaders'

export const Model = d.struct({
  matrix: d.mat4x4f,
  tint: d.vec4f,
  motion: d.vec4f,
})
export const modelLayout = tgpu.bindGroupLayout({ model: { uniform: Model } })
export const Sky = d.struct({
  inverse: d.mat4x4f,
  eye: d.vec4f,
  viewport: d.vec4f,
  left: d.vec4f,
  right: d.vec4f,
})
export const skyLayout = tgpu.bindGroupLayout({ sky: { uniform: Sky } })

export const modelVertex = tgpu.vertexFn({
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
  const model = modelLayout.$.model
  const world = std.mul(model.matrix, input.position)
  const normal = std.normalize(
    std.mul(model.matrix, d.vec4f(input.normal.xyz, 0)).xyz,
  )
  // Observatory-only hemisphere fill travels through the shared material's ambient channel.
  const fill = 0.035 + std.max(d.f32(0), normal.y) * 0.16
  return {
    position: std.mul(
      bookLayout.$.camera.projection,
      std.mul(bookLayout.$.camera.view, world),
    ),
    world: world.xyz,
    normal,
    color: d.vec4f(input.color.rgb.mul(model.tint.rgb), input.color.a),
    surface: d.vec4f(
      input.surface.xy,
      input.surface.z + model.tint.w + fill,
      input.surface.w,
    ),
  }
})

const corners = tgpu.const(d.arrayOf(d.vec2f, 6), [
  d.vec2f(-1, -1),
  d.vec2f(1, -1),
  d.vec2f(-1, 1),
  d.vec2f(-1, 1),
  d.vec2f(1, -1),
  d.vec2f(1, 1),
])

export const orbVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: { position: d.builtin.position, uv: d.vec2f, color: d.vec3f },
})((input) => {
  'use gpu'
  const camera = sceneLayout.$.camera
  const model = modelLayout.$.model
  const point = sceneLayout.$.points[input.instance]
  const core = worldPoint(point.xyz, input.instance, d.u32(model.motion.w))
  const phase = model.motion.x
  const energy = model.motion.y
  const fluid = std.select(d.f32(0), d.f32(1), model.motion.w > 1.5)
  // The crystallized world breathes radially; the reef carries a traveling curl.
  const twist =
    std.sin(core.y * 2.4 + phase * 0.65) * (energy * 0.2 + fluid * 0.07)
  const c = std.cos(twist)
  const s = std.sin(twist)
  const breath = 1 + energy * 0.13
  const local = d.vec3f(
    (core.x * c + core.z * s) * breath,
    core.y * (1 - energy * 0.05) +
      std.sin(core.x * 2.5 + phase) * energy * 0.045,
    (-core.x * s + core.z * c) * breath,
  )
  const world = std.mul(model.matrix, d.vec4f(local, 1))
  const center = std.mul(camera.view, world)
  const uv = corners.$[input.vertex]
  const position = std.mul(
    camera.projection,
    center.add(d.vec4f(uv.mul(camera.display.x * model.motion.z), 0, 0)),
  )
  const tint = std.smoothstep(
    0.25,
    0.75,
    0.5 + 0.5 * std.sin(point.w * 10 + point.y * 2),
  )
  return {
    position,
    uv: d.vec2f(uv),
    color: std.mix(camera.low.xyz, camera.high.xyz, tint).mul(camera.display.z),
  }
})

const hash3 = tgpu.fn(
  [d.vec3f],
  d.f32,
)((point) => {
  'use gpu'
  return std.fract(
    std.sin(std.dot(point, d.vec3f(127.1, 311.7, 74.7))) * 43758.5453,
  )
})

// Directional three-dimensional cells have no spherical UV seam or screen-fixed stars.
export const skyFragment = tgpu.fragmentFn({
  in: { position: d.builtin.position },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const sky = skyLayout.$.sky
  const ndc = d.vec2f(
    (input.position.x / sky.viewport.x) * 2 - 1,
    1 - (input.position.y / sky.viewport.y) * 2,
  )
  const far = std.mul(sky.inverse, d.vec4f(ndc, 1, 1))
  const ray = std.normalize(far.xyz.div(far.w).sub(sky.eye.xyz))
  const diagonal =
    ray.y + ray.x * 0.33 - 0.2 + std.sin(ray.z * 5 + ray.x * 4) * 0.04
  const breadth = 0.11 + (std.sin(ray.x * 2 - ray.z * 3) * 0.5 + 0.5) * 0.055
  const bandDistance = diagonal / breadth
  const belt = std.exp(-bandDistance * bandDistance)
  const folds =
    0.5 +
    std.sin(ray.x * 4 + ray.z * 3) * 0.23 +
    std.sin(ray.x * 7 - ray.y * 3 + 1.7) * 0.17 +
    std.sin(ray.z * 8 + ray.x * 2) * 0.1
  const leftGap = std.length(
    ray.sub(std.normalize(sky.left.xyz.sub(sky.eye.xyz))),
  )
  const rightGap = std.length(
    ray.sub(std.normalize(sky.right.xyz.sub(sky.eye.xyz))),
  )
  const clearings =
    std.smoothstep(0.07, 0.26, leftGap) * std.smoothstep(0.07, 0.23, rightGap)
  const haze = belt * (0.22 + std.pow(folds, 2) * 0.78) * 0.105 * clearings
  let color = d
    .vec3f(0.0015, 0.003, 0.009)
    .add(
      std
        .mix(d.vec3f(0.13, 0.3, 0.5), d.vec3f(0.48, 0.17, 0.4), folds)
        .mul(haze),
    )
  // A world-space halo gives each specimen its own light, without blurring the points.
  const leftRadius =
    sky.left.w / std.max(std.length(sky.left.xyz.sub(sky.eye.xyz)), 0.1)
  const rightRadius =
    sky.right.w / std.max(std.length(sky.right.xyz.sub(sky.eye.xyz)), 0.1)
  const warmDistance = leftGap / std.max(leftRadius, 0.001)
  const coolDistance = rightGap / std.max(rightRadius, 0.001)
  const warmHalo = std.exp(-warmDistance * warmDistance * 1.3) * 0.025
  const coolHalo = std.exp(-coolDistance * coolDistance * 1.15) * 0.034
  color = color
    .add(d.vec3f(1, 0.48, 0.14).mul(warmHalo))
    .add(d.vec3f(0.06, 0.58, 0.8).mul(coolHalo))
  for (const scale of std.range(2)) {
    const frequency = 125 + d.f32(scale) * 115
    const p = ray.mul(frequency)
    const cell = std.floor(p)
    const random = hash3(cell)
    const offset = d
      .vec3f(
        hash3(cell.add(d.vec3f(1, 3, 7))),
        hash3(cell.add(d.vec3f(8, 2, 4))),
        hash3(cell.add(d.vec3f(6, 9, 1))),
      )
      .mul(0.6)
      .add(d.vec3f(0.2))
    const delta = std.fract(p).sub(offset)
    const spot = std.exp(-std.dot(delta, delta) * 180)
    const strength = std.max(d.f32(0), random - 0.978) * 35
    color = color.add(
      std
        .mix(d.vec3f(0.35, 0.58, 1), d.vec3f(0.8, 0.86, 1), random)
        .mul(spot * strength),
    )
  }
  return d.vec4f(color, 0)
})

export const toneMapFragment = tgpu.fragmentFn({
  in: { position: d.builtin.position },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const color = std.textureLoad(
    resolveLayout.$.image,
    d.vec2i(input.position.xy),
    0,
  ).rgb
  const mapped = d
    .vec3f(1)
    .sub(std.exp(color.mul(-resolveLayout.$.camera.display.y)))
  return d.vec4f(std.pow(std.max(mapped, d.vec3f(0)), d.vec3f(1 / 2.2)), 1)
})
