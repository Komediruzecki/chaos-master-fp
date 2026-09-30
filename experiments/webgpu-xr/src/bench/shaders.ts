// Stable IFS samples, solid framing and HDR splats sharing one camera and depth.
import { d, std, tgpu } from 'typegpu'
import { advanceSeed } from '../flameMath'
import { advanceSpecimen, BURN_IN, SAMPLE_STEPS } from './recipes'

export const SampleConfig = d.struct({ values: d.vec4u })
export const View = d.struct({
  view: d.mat4x4f,
  projection: d.mat4x4f,
  display: d.vec4f,
  low: d.vec4f,
  high: d.vec4f,
  scene: d.vec4f,
})
export const samplingLayout = tgpu.bindGroupLayout({
  config: { uniform: SampleConfig },
  points: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
})
export const sceneLayout = tgpu.bindGroupLayout({
  camera: { uniform: View },
  points: { storage: d.arrayOf(d.vec4f) },
})
export const resolveLayout = tgpu.bindGroupLayout({
  image: { texture: d.texture2d(d.f32) },
  camera: { uniform: View },
})

export const constructSpecimen = tgpu.computeFn({
  workgroupSize: [64],
  in: { id: d.builtin.globalInvocationId },
})((input) => {
  'use gpu'
  const config = samplingLayout.$.config.values
  const chain = input.id.x
  if (chain >= config.y / SAMPLE_STEPS) return
  let seed = d.u32(config.z + chain)
  let point = d.vec4f(0.17, -0.23, 0.31, 0)
  for (const step of std.range(-BURN_IN, SAMPLE_STEPS)) {
    seed = advanceSeed(seed)
    point = advanceSpecimen(point, seed, config.x)
    if (step >= 0)
      samplingLayout.$.points[chain * SAMPLE_STEPS + d.u32(step)] =
        d.vec4f(point)
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

export const cloudVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: { position: d.builtin.position, uv: d.vec2f, color: d.vec3f },
})((input) => {
  'use gpu'
  const camera = sceneLayout.$.camera
  const point = sceneLayout.$.points[input.instance]
  const uv = corners.$[input.vertex]
  const center = std.mul(camera.view, d.vec4f(point.xyz, 1))
  const position = std.mul(
    camera.projection,
    center.add(d.vec4f(uv.mul(camera.display.x), 0, 0)),
  )
  const tint = std.smoothstep(
    0.25,
    0.75,
    0.5 + 0.5 * std.sin(point.w * 10 + point.y * 2),
  )
  const color = std
    .mix(camera.low.xyz, camera.high.xyz, tint)
    .mul(camera.display.z)
  return { position, uv: d.vec2f(uv), color }
})
export const cloudFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f, color: d.vec3f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const radius = std.dot(input.uv, input.uv)
  const falloff = std.max(d.f32(0), std.exp(-4 * radius) - 0.0184)
  return d.vec4f(input.color.mul(falloff), 0)
})

// Parametric solid tori are authored framing, separate from the fractal recipe.
const solidCorners = tgpu.const(d.arrayOf(d.vec2f, 6), [
  d.vec2f(0, 0),
  d.vec2f(1, 0),
  d.vec2f(0, 1),
  d.vec2f(0, 1),
  d.vec2f(1, 0),
  d.vec2f(1, 1),
])
export const solidVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: { position: d.builtin.position, color: d.vec3f },
})((input) => {
  'use gpu'
  const camera = sceneLayout.$.camera
  const corner = solidCorners.$[input.vertex % 6]
  let p = d.vec3f(0)
  let color = d.vec3f(0.12, 0.16, 0.2)
  if (input.instance < 2) {
    const tile = d.u32(input.vertex / 6)
    const a = (d.f32(d.u32(tile / 8)) + corner.x) * ((Math.PI * 2) / 192)
    const b = (d.f32(tile % 8) + corner.y) * ((Math.PI * 2) / 8)
    const tube = 0.0045
    const radius = 1.18 + d.f32(input.instance) * 0.12
    const q = d.vec3f(
      std.cos(a) * (radius + std.cos(b) * tube),
      std.sin(b) * tube,
      std.sin(a) * (radius + std.cos(b) * tube),
    )
    const tilt = 0.32 + d.f32(input.instance) * 0.58
    p = d.vec3f(
      q.x,
      q.y * std.cos(tilt) - q.z * std.sin(tilt),
      q.y * std.sin(tilt) + q.z * std.cos(tilt),
    )
    const light =
      0.28 +
      0.6 * std.max(d.f32(0), std.sin(b + 0.8)) +
      0.25 * std.pow(std.max(d.f32(0), std.cos(a - 0.8)), 12)
    color = d.vec3f(0.62, 0.36, 0.12).mul(light)
    if (camera.scene.x < 0.5) p = d.vec3f(0)
  } else {
    // A real opaque plane is sufficient to reveal front/inside/behind ordering.
    p = d.vec3f((corner.x - 0.5) * 0.17, (corner.y - 0.5) * 2.7, camera.scene.z)
    color = std.mix(
      d.vec3f(0.045, 0.08, 0.1),
      d.vec3f(0.19, 0.25, 0.3),
      corner.x,
    )
    if (camera.scene.y < 0.5) p = d.vec3f(0)
  }
  return {
    position: std.mul(camera.projection, std.mul(camera.view, d.vec4f(p, 1))),
    color,
  }
})
export const solidFragment = tgpu.fragmentFn({
  in: { color: d.vec3f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  return d.vec4f(input.color, 1)
})

export const fullScreenVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex },
  out: { position: d.builtin.position },
})((input) => {
  'use gpu'
  const x = d.f32((input.vertex << 1) & 2)
  const y = d.f32(input.vertex & 2)
  return { position: d.vec4f(x * 2 - 1, y * 2 - 1, 0, 1) }
})
export const resolveFragment = tgpu.fragmentFn({
  in: { position: d.builtin.position },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const camera = resolveLayout.$.camera
  const sample = std.textureLoad(
    resolveLayout.$.image,
    d.vec2i(input.position.xy),
    0,
  )
  const hdr = sample.rgb
  const mapped = d.vec3f(1).sub(std.exp(hdr.mul(-camera.display.y)))
  let sky = d.vec3f(7 / 255, 17 / 255, 28 / 255)
  if (camera.display.w > 0.5 && sample.a < 0.5) {
    // Stationary screen-space atmosphere only; it is never depth-test evidence.
    const cell = std.floor(input.position.xy.mul(0.11))
    const hash = std.fract(
      std.sin(std.dot(cell, d.vec2f(127.1, 311.7))) * 43758.5453,
    )
    const spot = std.fract(input.position.xy.mul(0.11)).sub(d.vec2f(0.5))
    const star =
      std.max(d.f32(0), (hash - 0.986) * 65) *
      std.exp(-80 * std.dot(spot, spot))
    sky = sky.add(d.vec3f(0.38, 0.5, 0.63).mul(star))
  }
  return d.vec4f(
    std.pow(mapped, d.vec3f(1 / 2.2)).add(sky.mul(d.vec3f(1).sub(mapped))),
    1,
  )
})
