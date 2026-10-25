/** GPU sampling of baked chunk contact trajectories, independent of the rigid study. */
import { d, std, tgpu } from 'typegpu'
import { cameraLayout } from './pawnBoardShaders'

export const contactChunkLayout = tgpu.vertexLayout(
  d.disarrayOf(d.unstruct({ chunkId: d.uint32 })),
)
export const ContactPose = d.struct({
  displacement: d.vec4f,
  rotation: d.vec4f,
})
export const contactMotionLayout = tgpu.bindGroupLayout({
  timing: { uniform: d.vec4f },
  poses: { storage: d.arrayOf(ContactPose) },
})

/** Shortest-arc normalized interpolation avoids q/-q cancellation during seeking. */
export const contactRotation = tgpu.fn(
  [d.vec4f, d.vec4f, d.f32],
  d.vec4f,
)((first, second, blend) => {
  'use gpu'
  let end = d.vec4f(second)
  if (std.dot(first, end) < 0) end = std.mul(end, -1)
  return std.normalize(std.mix(first, end, std.clamp(blend, 0, 1)))
})

export const rotateContactVertex = tgpu.fn(
  [d.vec3f, d.vec4f],
  d.vec3f,
)((vertex, rotation) => {
  'use gpu'
  const cross = std.mul(std.cross(rotation.xyz, vertex), 2)
  return std.add(
    vertex,
    std.add(std.mul(cross, rotation.w), std.cross(rotation.xyz, cross)),
  )
})

export const contactVertex = tgpu.vertexFn({
  in: {
    vertex: d.vec3f,
    normal: d.vec3f,
    colour: d.vec3f,
    centroid: d.vec3f,
    velocity: d.vec3f,
    angular: d.vec3f,
    radius: d.f32,
    chunkId: d.u32,
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
  const timing = contactMotionLayout.$.timing
  const frame = std.clamp(input.effect.x * timing.x, 0, timing.y - 1)
  const lower = d.u32(std.floor(frame))
  const upper = std.min(lower + 1, d.u32(timing.y) - 1)
  const count = d.u32(timing.z)
  const first = contactMotionLayout.$.poses[lower * count + input.chunkId]!
  const second = contactMotionLayout.$.poses[upper * count + input.chunkId]!
  const blend = frame - std.floor(frame)
  const rotation = contactRotation(first.rotation, second.rotation, blend)
  const displacement = std.mix(
    first.displacement.xyz,
    second.displacement.xyz,
    blend,
  )
  const local = std.add(
    std.add(input.centroid, displacement),
    rotateContactVertex(input.vertex, rotation),
  )
  const world = std.add(std.mul(local, input.offset.w), input.offset.xyz)
  let colour = d.vec3f(input.colour)
  if (input.effect.w > 0.5) colour = std.mul(colour, input.tint.xyz)
  return {
    position: std.mul(cameraLayout.$.camera.viewProjection, d.vec4f(world, 1)),
    world,
    normal: rotateContactVertex(input.normal, rotation),
    colour,
    selected: input.effect.y,
  }
})
