/** One Jacobi render-only corner pass, completed before normals read its output. */
import { d, std, tgpu } from 'typegpu'
import { gummyRoundingScale } from './gummyRoundedSurface'
import { gummyTetInradius } from './gummyRuntimeSurfaceMath'
import { gummyCameraLayout as camera, gummyNormalsLayout as layout, } from './gummyShaders'

export const gummyRoundingCompute = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const id = gid.x
  const count = std.arrayLength(layout.$.positions)
  if (id >= count) return
  const original = layout.$.positions[id]!.xyz
  const rest = layout.$.restPositions[id]!.xyz
  let world = d.vec3f(original)
  let material = d.vec3f(rest)
  let scale = d.f32(0)
  if (
    camera.$.camera.surface.x > 0.5 &&
    std.arrayLength(layout.$.ranges) >= count * 4
  ) {
    const stencil = layout.$.ranges[count * 3 + id]!
    if (stencil.y >= 3) {
      let delta = d.vec3f(0)
      let restDelta = d.vec3f(0)
      for (let offset = d.u32(0); offset < stencil.y; offset++) {
        const entry = layout.$.adjacent[stencil.x + offset]!
        const weight = d.f32(entry.y) / 16777216
        delta = std.add(
          delta,
          std.mul(std.sub(layout.$.positions[entry.x]!.xyz, original), weight),
        )
        restDelta = std.add(
          restDelta,
          std.mul(std.sub(layout.$.restPositions[entry.x]!.xyz, rest), weight),
        )
      }
      const tets = layout.$.ranges[count * 2 + id]!
      let support = d.f32(1000000)
      for (let offset = d.u32(0); offset < tets.y; offset++) {
        const first = layout.$.adjacent[tets.x + offset * 2]!
        const second = layout.$.adjacent[tets.x + offset * 2 + 1]!
        support = std.min(
          support,
          gummyTetInradius(
            layout.$.positions[first.x]!.xyz,
            layout.$.positions[first.y]!.xyz,
            layout.$.positions[second.x]!.xyz,
            layout.$.positions[second.y]!.xyz,
          ),
        )
      }
      if (tets.y > 0) scale = gummyRoundingScale(delta, support)
      world = std.add(original, std.mul(delta, scale))
      material = std.add(rest, std.mul(restDelta, scale))
    }
  }
  layout.$.normals[count * 2 + id] = d.vec4f(world, scale)
  layout.$.normals[count * 3 + id] = d.vec4f(material, scale)
})
