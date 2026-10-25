/** Small screen-space quads visualize a world-space grip target inside recorded frames. */
import { d, std, tgpu } from 'typegpu'

export const GummyPointerUniform = d.struct({
  viewProjection: d.mat4x4f,
  // Framebuffer size, active grip, and sRGB attachment encoding.
  viewport: d.vec4f,
  // Normalized cursor position, has world target, has world origin.
  pointer: d.vec4f,
  endPoint: d.vec4f,
  startPoint: d.vec4f,
})
export const gummyPointerLayout = tgpu.bindGroupLayout({
  pointer: { uniform: GummyPointerUniform },
})

/** Near/far clipping prevents a behind-camera point from producing a giant mirrored marker. */
export const gummyPointerProject = tgpu.fn(
  [d.mat4x4f, d.vec3f, d.vec2f],
  d.vec3f,
)((matrix, point, size) => {
  'use gpu'
  const clip = std.mul(matrix, d.vec4f(point, 1))
  if (clip.w <= 0.00001 || clip.z < 0 || clip.z > clip.w) return d.vec3f(0)
  return d.vec3f(
    ((clip.x / clip.w) * 0.5 + 0.5) * size.x,
    (0.5 - (clip.y / clip.w) * 0.5) * size.y,
    1,
  )
})

const varyings = { local: d.vec2f, shape: d.vec3f }

export const gummyPointerVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: { position: d.builtin.position, ...varyings },
})((input) => {
  'use gpu'
  const config = gummyPointerLayout.$.pointer
  const corners = d.arrayOf(
    d.vec2f,
    6,
  )([
    d.vec2f(0, 0),
    d.vec2f(1, 0),
    d.vec2f(0, 1),
    d.vec2f(0, 1),
    d.vec2f(1, 0),
    d.vec2f(1, 1),
  ])
  const corner = corners[input.vertex]!
  let destination = d.vec3f(std.mul(config.pointer.xy, config.viewport.xy), 1)
  if (config.viewport.z > 0.5 && config.pointer.z > 0.5)
    destination = gummyPointerProject(
      config.viewProjection,
      config.endPoint.xyz,
      config.viewport.xy,
    )
  const origin = gummyPointerProject(
    config.viewProjection,
    config.startPoint.xyz,
    config.viewport.xy,
  )
  let local = std.mul(std.sub(std.mul(corner, 2), d.vec2f(1)), 18)
  let pixel = std.add(destination.xy, local)
  let valid = d.f32(destination.z)
  let length = d.f32(0)
  if (input.instance === 0) {
    valid *= origin.z * config.viewport.z * config.pointer.z * config.pointer.w
    const delta = std.sub(destination.xy, origin.xy)
    length = std.length(delta)
    const direction = std.div(delta, std.max(length, 0.0001))
    const normal = d.vec2f(-direction.y, direction.x)
    local = d.vec2f(corner.x * (length + 12) - 6, corner.y * 12 - 6)
    pixel = std.add(
      origin.xy,
      std.add(std.mul(direction, local.x), std.mul(normal, local.y)),
    )
  } else if (input.instance === 2) {
    valid = origin.z * config.viewport.z * config.pointer.z * config.pointer.w
    local = std.mul(std.sub(std.mul(corner, 2), d.vec2f(1)), 9)
    pixel = std.add(origin.xy, local)
  }
  let position = d.vec4f(
    (pixel.x / config.viewport.x) * 2 - 1,
    1 - (pixel.y / config.viewport.y) * 2,
    0,
    1,
  )
  if (valid < 0.5) position = d.vec4f(2, 2, 0, 1)
  return {
    position,
    local,
    shape: d.vec3f(d.f32(input.instance), length, config.viewport.z),
  }
})

/** Capsule distance, including the zero-length case, gives the tether rounded ends. */
export const gummyPointerLineDistance = tgpu.fn(
  [d.vec2f, d.f32],
  d.f32,
)((point, length) => {
  'use gpu'
  return std.length(
    d.vec2f(std.max(std.max(-point.x, point.x - length), 0), point.y),
  )
})

export const gummyPointerFragment = tgpu.fragmentFn({
  in: varyings,
  out: d.vec4f,
})((input) => {
  'use gpu'
  const active = input.shape.z
  let colour = std.mix(
    d.vec3f(0.06, 0.69, 0.79),
    d.vec3f(1, 0.58, 0.16),
    active,
  )
  let alpha = d.f32(0)
  if (input.shape.x < 0.5) {
    const distance = gummyPointerLineDistance(input.local, input.shape.y)
    const core = 1 - std.smoothstep(0.55, 1.45, distance)
    const glow = std.exp(-distance * distance * 0.2)
    alpha = 0.68 * core + 0.14 * glow
    colour = std.mix(colour, d.vec3f(1, 0.87, 0.51), core * 0.65)
  } else {
    const radius = std.length(input.local)
    let ringRadius = std.mix(8.5, 10, active)
    if (input.shape.x > 1.5) ringRadius = d.f32(3.5)
    const edge = std.abs(radius - ringRadius)
    const ring = 1 - std.smoothstep(0.55, 1.4, edge)
    const outline = 1 - std.smoothstep(1.1, 2.5, edge)
    let core = (1 - std.smoothstep(1.6, 3, radius)) * active
    if (input.shape.x > 1.5) core = d.f32(0)
    const glow = std.exp(-edge * edge * 0.2) * active * 0.14
    alpha = std.max(std.max(ring * 0.88, outline * 0.38), core * 0.98) + glow
    const mark = std.max(ring, core)
    colour = std.mix(
      d.vec3f(0.08, 0.11, 0.13),
      colour,
      std.clamp(mark + glow, 0, 1),
    )
    colour = std.mix(colour, d.vec3f(1, 0.94, 0.71), core)
  }
  if (gummyPointerLayout.$.pointer.viewport.w > 0.5)
    colour = std.pow(colour, d.vec3f(2.2))
  return d.vec4f(colour, std.clamp(alpha, 0, 1))
})
