/** Deformed skin and exposed-cap normals for the gummy mesh. */
import { d, std, tgpu } from 'typegpu'
import { EXPOSED_TEAR_FACE } from '@/simulation/gummy/gummyMesh'
import { gummyUnitNormal } from './gummyMaterial'
import { gummyTetInradius } from './gummyRuntimeSurfaceMath'
import { gummyCameraLayout, gummyNormalsLayout } from './gummyShaderLayouts'
import { gummyExposedCapAreaNormal, gummyTransportNormal, } from './gummySurfaceMath'

const gummyNormalPosition = tgpu.fn(
  [d.u32],
  d.vec3f,
)((id) => {
  'use gpu'
  if (gummyCameraLayout.$.camera.surface.x > 0.5)
    return d.vec3f(
      gummyNormalsLayout.$.normals[
        std.arrayLength(gummyNormalsLayout.$.positions) * 2 + id
      ]!.xyz,
    )
  return d.vec3f(gummyNormalsLayout.$.positions[id]!.xyz)
})
const gummyNormalRestPosition = tgpu.fn(
  [d.u32],
  d.vec3f,
)((id) => {
  'use gpu'
  if (gummyCameraLayout.$.camera.surface.x > 0.5)
    return d.vec3f(
      gummyNormalsLayout.$.normals[
        std.arrayLength(gummyNormalsLayout.$.positions) * 3 + id
      ]!.xyz,
    )
  return d.vec3f(gummyNormalsLayout.$.restPositions[id]!.xyz)
})
/** Rest-coincident boundary triangles share normals while their nodes remain together. */
export const gummyNormalsCompute = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})((input) => {
  'use gpu'
  const id = input.gid.x
  if (id >= std.arrayLength(gummyNormalsLayout.$.positions)) return
  const position = gummyNormalPosition(id)
  const range = gummyNormalsLayout.$.ranges[id]!
  let sum = d.vec3f(0)
  for (let offset = d.u32(0); offset < range.y; offset++) {
    const pair = gummyNormalsLayout.$.adjacent[range.x + offset]!
    const near = std.sub(gummyNormalPosition(pair.y), position)
    // Once fractured copies have separated, they must stop smoothing across the gap.
    if (std.dot(near, near) < 0.001225) {
      const face = gummyNormalsLayout.$.faces[pair.x]!
      const a = gummyNormalPosition(face.x)
      const b = gummyNormalPosition(face.y)
      const c = gummyNormalPosition(face.z)
      const restA = gummyNormalRestPosition(face.x)
      const restB = gummyNormalRestPosition(face.y)
      const restC = gummyNormalRestPosition(face.z)
      const transported = gummyTransportNormal(
        gummyNormalsLayout.$.restNormals[id]!.xyz,
        restA,
        restB,
        restC,
        a,
        b,
        c,
      )
      const areaNormal = std.cross(std.sub(b, a), std.sub(c, a))
      const count = std.arrayLength(gummyNormalsLayout.$.positions)
      let weighted = std.mul(transported, std.length(areaNormal))
      if (
        gummyCameraLayout.$.camera.surface.x > 0.5 &&
        (gummyNormalsLayout.$.normals[count * 2 + face.x]!.w > 0 ||
          gummyNormalsLayout.$.normals[count * 2 + face.y]!.w > 0 ||
          gummyNormalsLayout.$.normals[count * 2 + face.z]!.w > 0)
      )
        weighted = d.vec3f(areaNormal)
      sum = std.add(sum, weighted)
    }
  }
  const normal = gummyUnitNormal(sum, gummyNormalsLayout.$.restNormals[id]!.xyz)
  gummyNormalsLayout.$.normals[id] = d.vec4f(normal, 0)
  const count = std.arrayLength(gummyNormalsLayout.$.positions)
  const localRange = gummyNormalsLayout.$.ranges[count + id]!
  let boundary = d.vec3f(0)
  let fallback = d.vec3f(0)
  let largestArea = d.f32(0)
  let exposed = d.bool(false)
  for (let offset = d.u32(0); offset < localRange.y; offset++) {
    const pair = gummyNormalsLayout.$.adjacent[localRange.x + offset]!
    const face = gummyNormalsLayout.$.faces[pair.x]!
    const a = gummyNormalPosition(face.x)
    const b = gummyNormalPosition(face.y)
    const c = gummyNormalPosition(face.z)
    if (face.w === 0xffffffff) {
      const transported = gummyTransportNormal(
        gummyNormalsLayout.$.restNormals[id]!.xyz,
        gummyNormalRestPosition(face.x),
        gummyNormalRestPosition(face.y),
        gummyNormalRestPosition(face.z),
        a,
        b,
        c,
      )
      const areaNormal = std.cross(std.sub(b, a), std.sub(c, a))
      let weighted = std.mul(transported, std.length(areaNormal))
      if (
        gummyCameraLayout.$.camera.surface.x > 0.5 &&
        (gummyNormalsLayout.$.normals[count * 2 + face.x]!.w > 0 ||
          gummyNormalsLayout.$.normals[count * 2 + face.y]!.w > 0 ||
          gummyNormalsLayout.$.normals[count * 2 + face.z]!.w > 0)
      )
        weighted = d.vec3f(areaNormal)
      boundary = std.add(boundary, weighted)
    } else {
      let damage = d.f32(1)
      if (face.w !== EXPOSED_TEAR_FACE)
        damage = gummyNormalsLayout.$.damage[face.w]!
      const areaNormal = gummyExposedCapAreaNormal(a, b, c, damage)
      const area = std.length(areaNormal)
      if (area > 0) exposed = true
      boundary = std.add(boundary, areaNormal)
      if (area > largestArea) {
        fallback = d.vec3f(areaNormal)
        largestArea = area
      }
    }
  }
  const capNormal = gummyUnitNormal(boundary, fallback)
  let radius = d.f32(0)
  if (exposed && std.arrayLength(gummyNormalsLayout.$.ranges) >= count * 3) {
    const tets = gummyNormalsLayout.$.ranges[count * 2 + id]!
    radius = 1000000
    for (let offset = d.u32(0); offset < tets.y; offset++) {
      const first = gummyNormalsLayout.$.adjacent[tets.x + offset * 2]!
      const second = gummyNormalsLayout.$.adjacent[tets.x + offset * 2 + 1]!
      radius = std.min(
        radius,
        gummyTetInradius(
          gummyNormalsLayout.$.positions[first.x]!.xyz,
          gummyNormalsLayout.$.positions[first.y]!.xyz,
          gummyNormalsLayout.$.positions[second.x]!.xyz,
          gummyNormalsLayout.$.positions[second.y]!.xyz,
        ),
      )
    }
    radius = std.max(radius, 0.0000001)
    // Only vertices of actual opened faces adopt closed-boundary normals.
    // The smooth original skin away from a crack retains its previous normals.
    gummyNormalsLayout.$.normals[id] = d.vec4f(capNormal, radius)
  }
  gummyNormalsLayout.$.normals[count + id] = d.vec4f(capNormal, radius)
})
