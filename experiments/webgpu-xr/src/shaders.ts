// Build a stable GPU cloud on demand, then draw its world-space splats per eye.
import { d, std, tgpu } from 'typegpu'
import { advancePoint, advanceSeed } from './flameMath'
import { deformFlamePoint } from './flameMotion'
import { BURN_IN, CHAIN_COUNT, FLAME_SEED, initialPoint, POINT_COUNT, SAMPLES_PER_CHAIN, } from './sampling'

export const STAR_COUNT = 1200
export const RIBBON_COUNT = 1152
export const Camera = d.struct({
  view: d.mat4x4f,
  projection: d.mat4x4f,
  params: d.vec4f,
  audio: d.vec4f,
  music: d.vec4f,
})
export const computeLayout = tgpu.bindGroupLayout({
  points: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
})
export const renderLayout = tgpu.bindGroupLayout({
  camera: { uniform: Camera },
  points: { storage: d.arrayOf(d.vec4f) },
  stars: { storage: d.arrayOf(d.vec4f) },
})

export const computeFlame = tgpu.computeFn({
  workgroupSize: [64],
  in: { id: d.builtin.globalInvocationId },
})((input) => {
  'use gpu'
  const chain = input.id.x
  if (chain >= CHAIN_COUNT) return
  let seed = d.u32(FLAME_SEED + chain)
  let point = d.vec4f(initialPoint.$)
  // Rebuild from the same paths, never from last frame's positions or RNG.
  for (const step of std.range(-BURN_IN, SAMPLES_PER_CHAIN)) {
    seed = advanceSeed(seed)
    point = advancePoint(point, seed)
    if (step >= 0)
      computeLayout.$.points[chain * SAMPLES_PER_CHAIN + d.u32(step)] =
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
const triangle = tgpu.const(d.arrayOf(d.vec3f, 3), [
  d.vec3f(-0.45, -0.35, 0),
  d.vec3f(0.45, -0.35, 0),
  d.vec3f(0, 0.45, 0),
])

export const vertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: {
    position: d.builtin.position,
    uv: d.vec2f,
    color: d.vec4f,
    soft: d.f32,
  },
})((input) => {
  'use gpu'
  const camera = renderLayout.$.camera
  if (camera.params.w > 0.5) {
    const i = d.f32(input.instance)
    const p = triangle.$[input.vertex].add(
      d.vec3f((i - 1) * 0.75, 1.6, -2.5 - i * 0.35),
    )
    return {
      position: std.mul(camera.projection, std.mul(camera.view, d.vec4f(p, 1))),
      uv: d.vec2f(0),
      color: d.vec4f(0.2 + i * 0.25, 0.9 - i * 0.15, 1 - i * 0.3, 1),
      soft: d.f32(0),
    }
  }
  let p = d.vec3f(0)
  let color = d.vec3f(0)
  let radius = d.f32(0.0045)
  let alpha = d.f32(0.42)
  const strength = std.clamp(camera.music.y, 0, 1)
  const bands = std.clamp(camera.audio, d.vec4f(0), d.vec4f(1)).mul(strength)
  const phase = camera.music.x
  if (input.instance < POINT_COUNT) {
    const point = renderLayout.$.points[input.instance]
    // Pure rest-pose deformation: no accumulated displacement or new samples.
    p = deformFlamePoint(point, bands, phase, camera.params.x)
    const flow = 0.5 + 0.5 * std.sin(point.y * 3 + point.x * 1.5 - phase * 0.8)
    color = std
      .mix(
        d.vec3f(0.03, 0.24, 0.42),
        d.vec3f(0.84, 0.95, 0.38),
        std.clamp(point.w + (flow - 0.5) * bands.w * 0.35, 0, 1),
      )
      .mul(1 + bands.x * 0.1)
    color = std.mix(color, d.vec3f(0.34, 0.2, 0.65), flow * bands.z * 0.55)
  } else if (input.instance < POINT_COUNT + STAR_COUNT) {
    const star = renderLayout.$.stars[input.instance - POINT_COUNT]
    p = d.vec3f(star.xyz)
    color = std.mix(d.vec3f(0.35, 0.48, 0.75), d.vec3f(0.9, 0.82, 0.59), star.w)
    radius = 0.02 + star.w * 0.025
    alpha = 0.65
  } else {
    // Three persistent orbital threads give the music a readable silhouette.
    // They share world coordinates and audio time across eyes, with no feedback.
    const index = input.instance - POINT_COUNT - STAR_COUNT
    const strand = std.floor(d.f32(index) / 384)
    const angle = d.f32(index % 384) * ((Math.PI * 2) / 384)
    const orbit = 0.98 + strand * 0.07 + bands.y * 0.13
    const x = std.cos(angle) * orbit
    const y =
      std.sin(angle) * (0.22 + strand * 0.07) +
      std.sin(angle * 3 + phase * 0.6) * bands.z * 0.1
    const tilt = (strand - 1) * 0.65
    p = d
      .vec3f(
        x * std.cos(tilt) - y * std.sin(tilt),
        x * std.sin(tilt) + y * std.cos(tilt),
        std.sin(angle) * orbit * 0.55,
      )
      .add(d.vec3f(0, 1.6, -2.5))
    const crest = 0.5 + 0.5 * std.sin(angle * 2 - phase * 0.8 + strand * 2)
    color = std.mix(
      d.vec3f(0.08, 0.5, 0.58),
      d.vec3f(0.55, 0.35, 0.7),
      strand / 2,
    )
    radius = 0.004 + bands.w * crest * 0.007
    alpha = bands.x * (0.18 + crest * 0.5)
  }
  const uv = corners.$[input.vertex]
  const center = std.mul(camera.view, d.vec4f(p, 1))
  const billboard = center.add(d.vec4f(uv.mul(radius), 0, 0))
  return {
    position: std.mul(camera.projection, billboard),
    uv: d.vec2f(uv),
    color: d.vec4f(color, alpha),
    soft: d.f32(1),
  }
})

export const fragment = tgpu.fragmentFn({
  in: { uv: d.vec2f, color: d.vec4f, soft: d.f32 },
  out: d.vec4f,
})((input) => {
  'use gpu'
  let falloff = d.f32(1)
  if (input.soft > 0.5) falloff = std.exp(-3.5 * std.dot(input.uv, input.uv))
  return d.vec4f(input.color.rgb.mul(input.color.a * falloff), 1)
})
