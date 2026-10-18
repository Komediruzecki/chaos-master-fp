// Score-linked light veil behind the temple; one bounded quad in the existing HDR pass.
import { d, std, tgpu } from 'typegpu'
import { bookLayout } from '../almanac/bookShaders'
import { TEMPLE_DURATION_SECONDS } from '../journey/templeScore'
import { templeLighting } from './templeMaterial'
import type { TgpuBuffer, TgpuRoot, UniformFlag } from 'typegpu'
import type { View } from '../bench/shaders'
import type { TemplePresentation } from './temple'

const Atmosphere = d.struct({ light: d.vec4f, drift: d.vec4f })
const atmosphereLayout = tgpu.bindGroupLayout({
  atmosphere: { uniform: Atmosphere },
})
const corners = tgpu.const(d.arrayOf(d.vec2f, 6), [
  d.vec2f(-1, -1),
  d.vec2f(1, -1),
  d.vec2f(-1, 1),
  d.vec2f(-1, 1),
  d.vec2f(1, -1),
  d.vec2f(1, 1),
])

// Playback progress is the only clock: stopping freezes the veil, motion-off fixes its drift.
export function templeAtmospherePhase(
  state: TemplePresentation,
  motion: boolean,
) {
  if (!state.active || !motion || !Number.isFinite(state.progress)) return 0
  return Math.max(0, Math.min(1, state.progress)) * TEMPLE_DURATION_SECONDS
}

const atmosphereVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex },
  out: { position: d.builtin.position, local: d.vec2f },
})((input) => {
  'use gpu'
  const uv = corners.$[input.vertex]
  const local = uv.mul(d.vec2f(6, 5))
  const world = d.vec4f(local.x, local.y + 2.15, -13.1, 1)
  return {
    position: std.mul(
      bookLayout.$.camera.projection,
      std.mul(bookLayout.$.camera.view, world),
    ),
    local,
  }
})

const atmosphereFragment = tgpu.fragmentFn({
  in: { local: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const p = input.local
  const light = atmosphereLayout.$.atmosphere.light
  const phase = atmosphereLayout.$.atmosphere.drift.x
  const edge =
    (1 - std.smoothstep(3.6, 5.8, std.abs(p.x))) *
    (1 - std.smoothstep(3.1, 4.8, std.abs(p.y)))
  const warm = d.vec3f(1, 0.39, 0.095)
  const cool = d.vec3f(0.075, 0.55, 0.65)
  const side = std.smoothstep(-1.6, 1.6, p.x)
  const tint = std.mix(warm.mul(light.x), cool.mul(light.y), side)
  const halo = std.exp(-p.x * p.x * 0.5 - p.y * p.y * 0.33)
  const heart = std.exp(-p.x * p.x * 1.8 - p.y * p.y * 1.2)
  // Slow asymmetric curtains stay behind the stone and keep the orb silhouettes clear.
  const curl =
    std.sin(p.y * 1.6 + phase * 0.045) * 0.2 +
    std.sin(p.y * 3.2 - phase * 0.025) * 0.06
  const left = p.x + 0.84 + curl
  const right = p.x - 0.84 + curl * 0.7
  const curtains =
    (std.exp(-left * left * 18) + std.exp(-right * right * 22)) *
    std.exp(-p.y * p.y * 0.21)
  const folds =
    0.65 +
    0.2 * std.sin(p.y * 5 + p.x * 2 - phase * 0.1) +
    0.15 * std.sin(p.y * 8 - p.x * 4 + phase * 0.055)
  const radius = std.length(p.mul(d.vec2f(1, 0.88)))
  const ringDistance = radius - 1.38
  const aureole =
    std.exp(-ringDistance * ringDistance * 34) *
    (0.55 + 0.45 * std.sin(p.y * 3.7 + p.x * 2.3))
  const shaftDistance = p.x + std.sin(p.y * 0.7) * 0.09
  const shaft = std.exp(-shaftDistance * shaftDistance * 32 - p.y * p.y * 0.25)
  const radiance = tint
    .mul(halo * 0.028 + curtains * folds * 0.038)
    .add(d.vec3f(0.28, 0.6, 0.55).mul(heart * light.z * 0.028))
    .add(
      d.vec3f(0.87, 0.7, 0.35).mul((aureole * 0.03 + shaft * 0.014) * light.w),
    )
  return d.vec4f(radiance.mul(edge), 0)
})

export function createTempleAtmosphere(
  root: TgpuRoot,
  camera: TgpuBuffer<typeof View> & UniformFlag,
) {
  const uniform = root.createBuffer(Atmosphere).$usage('uniform')
  try {
    const pipeline = root
      .createRenderPipeline({
        vertex: atmosphereVertex,
        fragment: atmosphereFragment,
        targets: {
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
          },
        },
        multisample: { count: 4 },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: false,
          depthCompare: 'less-equal',
        },
      })
      .with(root.createBindGroup(bookLayout, { camera }))
      .with(root.createBindGroup(atmosphereLayout, { atmosphere: uniform }))
    root.unwrap(pipeline)
    const raw = new Float32Array(d.sizeOf(Atmosphere) / 4)
    return {
      bytes: d.sizeOf(Atmosphere),
      draw(
        pass: GPURenderPassEncoder,
        state: TemplePresentation,
        motion: boolean,
      ) {
        if (!state.active) return false
        const light = templeLighting(state)
        raw.set([light.warm, light.cool, light.confluence, light.seal], 0)
        raw[4] = templeAtmospherePhase(state, motion)
        uniform.write(raw.buffer)
        pipeline.with(pass).draw(6)
        return true
      },
      dispose() {
        uniform.destroy()
      },
    }
  } catch (error) {
    uniform.destroy()
    throw error
  }
}
