/** Coloured finite-volume fragments with deterministic rigid motion for the solid study. */
import { d, std, tgpu } from 'typegpu'
import { cameraLayout, rotateFragment } from './pawnBoardShaders'
import { boardSpecular } from './pawnGlassMaterial'

export const solidLayout = tgpu.vertexLayout(
  d.disarrayOf(
    d.unstruct({
      vertex: d.float32x3,
      normal: d.float32x3,
      colour: d.float32x3,
      centroid: d.float32x3,
      velocity: d.float32x3,
      angular: d.float32x3,
      radius: d.float32,
    }),
  ),
)

/** Sphere support is conservative; the brief ramp preserves the exact rest pose. */
export const solidChunkPosition = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32],
  d.vec3f,
)((vertex, centroid, velocity, angular, radius, age) => {
  'use gpu'
  if (age <= 0) return std.add(vertex, centroid)
  const drift = (1 - std.exp(-age * 0.9)) / 0.9
  const centre = std.add(centroid, std.mul(velocity, drift))
  const floor = std.mix(
    std.min(centroid.y, radius),
    radius,
    std.smoothstep(0, 0.12, age),
  )
  centre.y = std.max(centroid.y + velocity.y * age - 4.9 * age * age, floor)
  return std.add(rotateFragment(vertex, std.mul(angular, drift)), centre)
})

export const solidVertex = tgpu.vertexFn({
  in: {
    vertex: d.vec3f,
    normal: d.vec3f,
    colour: d.vec3f,
    centroid: d.vec3f,
    velocity: d.vec3f,
    angular: d.vec3f,
    radius: d.f32,
    offset: d.vec4f,
    tint: d.vec4f,
    effect: d.vec4f,
  },
  out: {
    position: d.builtin.position,
    world: d.vec3f,
    normal: d.vec3f,
    colour: d.vec3f,
    selected: d.f32,
  },
})((input) => {
  'use gpu'
  const age = std.max(input.effect.x, 0)
  const local = solidChunkPosition(
    input.vertex,
    input.centroid,
    input.velocity,
    input.angular,
    input.radius,
    age,
  )
  const world = std.add(std.mul(local, input.offset.w), input.offset.xyz)
  const drift = (1 - std.exp(-age * 0.9)) / 0.9
  let colour = d.vec3f(input.colour)
  if (input.effect.w > 0.5) colour = std.mul(colour, input.tint.xyz)
  return {
    position: std.mul(cameraLayout.$.camera.viewProjection, d.vec4f(world, 1)),
    world,
    normal: rotateFragment(input.normal, std.mul(input.angular, drift)),
    colour,
    selected: input.effect.y,
  }
})

export const solidFragment = tgpu.fragmentFn({
  in: { world: d.vec3f, normal: d.vec3f, colour: d.vec3f, selected: d.f32 },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const normal = std.normalize(input.normal)
  const view = std.normalize(
    std.sub(cameraLayout.$.camera.eye.xyz, input.world),
  )
  const light = std.normalize(d.vec3f(-0.45, 0.9, 0.4))
  const diffuse = 0.24 + 0.76 * std.max(std.dot(normal, light), 0)
  const specular = boardSpecular(normal, view, light, 0.48)
  let colour = std.add(std.mul(input.colour, diffuse), d.vec3f(specular * 0.28))
  colour = std.add(colour, std.mul(d.vec3f(0.02, 0.1, 0.12), input.selected))
  return d.vec4f(colour, 1)
})
