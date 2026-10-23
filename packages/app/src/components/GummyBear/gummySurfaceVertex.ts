/** Cohesive face reconstruction and vertex projection for gummy surfaces. */
import { d, std, tgpu } from 'typegpu'
import { EXPOSED_TEAR_FACE, EXTERIOR_FACE } from '@/simulation/gummy/gummyMesh'
import { gummyUnitNormal } from './gummyMaterial'
import { gummyRoundedTetPoint, gummySortedTetIds } from './gummyRoundedTet'
import { gummyBoundedTearPatch } from './gummyRuntimeSurfaceMath'
import { gummyCameraLayout, gummyMeshLayout } from './gummyShaderLayouts'
import { gummyCapNormal, gummyCohesiveEdgeFlatten, gummyPnPosition, } from './gummySurfaceMath'
import { gummyTearAdjacency } from './gummyTearMaterial'

const gummySurfacePosition = tgpu.fn(
  [d.u32],
  d.vec3f,
)((id) => {
  'use gpu'
  if (gummyCameraLayout.$.camera.surface.x > 0.5)
    return d.vec3f(
      gummyMeshLayout.$.normals[
        std.arrayLength(gummyMeshLayout.$.positions) * 2 + id
      ]!.xyz,
    )
  return d.vec3f(gummyMeshLayout.$.positions[id]!.xyz)
})
const gummySurfaceRestPosition = tgpu.fn(
  [d.u32],
  d.vec3f,
)((id) => {
  'use gpu'
  if (gummyCameraLayout.$.camera.surface.x > 0.5)
    return d.vec3f(
      gummyMeshLayout.$.normals[
        std.arrayLength(gummyMeshLayout.$.positions) * 3 + id
      ]!.xyz,
    )
  return d.vec3f(gummyMeshLayout.$.restPositions[id]!.xyz)
})

const surfaceOutput = {
  position: d.builtin.position,
  world: d.vec3f,
  normal: d.vec3f,
  visible: d.f32,
  interior: d.f32,
  rest: d.vec3f,
  component: d.f32,
  support: d.f32,
  torn: d.f32,
}

/** Traverse all cohesive faces meeting an edge; records follow the face prefix in flatEdges. */
export const gummyBrokenEdgeFlatten = tgpu.fn(
  [d.u32],
  d.f32,
)((head) => {
  'use gpu'
  let current = d.u32(head)
  const capacity = std.arrayLength(gummyMeshLayout.$.flatEdges)
  const damageCount = std.arrayLength(gummyMeshLayout.$.damage)
  // The bounded walk also avoids a malformed list trapping a vertex invocation.
  for (let visited = d.u32(0); current !== 0 && visited < capacity; visited++) {
    if (current >= capacity) break
    const record = gummyMeshLayout.$.flatEdges[current]!
    if (record.x === EXTERIOR_FACE) return d.f32(1)
    if (record.x > 0 && record.x <= damageCount) {
      if (gummyCohesiveEdgeFlatten(gummyMeshLayout.$.damage[record.x - 1]!) > 0)
        return d.f32(1)
    }
    current = record.y
  }
  return d.f32(0)
})

export const surfaceData = tgpu.fn(
  [d.u32],
  d.struct({
    world: d.vec3f,
    normal: d.vec3f,
    visible: d.f32,
    interior: d.f32,
    rest: d.vec3f,
    component: d.f32,
    support: d.f32,
    torn: d.f32,
  }),
)((corner) => {
  'use gpu'
  const sample = gummyMeshLayout.$.corners[corner]!
  const faceId = d.u32(sample.w)
  const face = gummyMeshLayout.$.faces[faceId]!
  const metadata = gummyMeshLayout.$.metadata[faceId]!
  const a = gummySurfacePosition(face.x)
  const b = gummySurfacePosition(face.y)
  const c = gummySurfacePosition(face.z)
  const normalA = gummyMeshLayout.$.normals[face.x]!
  const normalB = gummyMeshLayout.$.normals[face.y]!
  const normalC = gummyMeshLayout.$.normals[face.z]!
  const na = normalA.xyz
  const nb = normalB.xyz
  const nc = normalC.xyz
  const linear = std.add(
    std.add(std.mul(a, sample.x), std.mul(b, sample.y)),
    std.mul(c, sample.z),
  )
  const restA = gummySurfaceRestPosition(face.x)
  const restB = gummySurfaceRestPosition(face.y)
  const restC = gummySurfaceRestPosition(face.z)
  let rest = std.add(
    std.add(std.mul(restA, sample.x), std.mul(restB, sample.y)),
    std.mul(restC, sample.z),
  )
  let world = d.vec3f(linear)
  let normal = gummyUnitNormal(
    std.add(
      std.add(std.mul(na, sample.x), std.mul(nb, sample.y)),
      std.mul(nc, sample.z),
    ),
    na,
  )
  let visible = d.f32(1)
  let interior = d.f32(0)
  let support = d.f32(0)
  if (face.w !== 0xffffffff) {
    interior = 1
    visible = 0
    if (face.w === EXPOSED_TEAR_FACE) visible = 1
    else if (gummyMeshLayout.$.damage[face.w]! >= 1) visible = 1
    const count = std.arrayLength(gummyMeshLayout.$.positions)
    const capA = gummyMeshLayout.$.normals[count + face.x]!
    const capB = gummyMeshLayout.$.normals[count + face.y]!
    const capC = gummyMeshLayout.$.normals[count + face.z]!
    const average = std.add(
      std.add(std.mul(capA.xyz, sample.x), std.mul(capB.xyz, sample.y)),
      std.mul(capC.xyz, sample.z),
    )
    normal = gummyCapNormal(average, std.cross(std.sub(b, a), std.sub(c, a)))
    if (metadata.z > 0) {
      const bounds = std.min(
        d.vec3f(capA.w, capB.w, capC.w),
        d.vec3f(gummyCameraLayout.$.camera.absorption.w / 0.35),
      )
      world = gummyBoundedTearPatch(
        a,
        b,
        c,
        na,
        nb,
        nc,
        sample.xyz,
        std.mul(bounds, 0.35),
      )
      support = std.dot(d.vec3f(capA.w, capB.w, capC.w), sample.xyz) * 2
    }
  } else {
    const edgeHeads = gummyMeshLayout.$.flatEdges[faceId]!
    const flatEdges = d.vec3f(
      gummyBrokenEdgeFlatten(edgeHeads.x),
      gummyBrokenEdgeFlatten(edgeHeads.y),
      gummyBrokenEdgeFlatten(edgeHeads.z),
    )
    const patch = gummyPnPosition(a, b, c, na, nb, nc, sample.xyz, flatEdges)
    const offset = std.sub(patch, linear)
    const length = std.length(offset)
    // Limit curved reconstruction near coarse facial recesses and tear edges.
    const scale = std.min(
      1,
      gummyCameraLayout.$.camera.absorption.w / std.max(length, 0.000001),
    )
    world = std.add(linear, std.mul(offset, scale))
    if (metadata.z > 0 && (normalA.w > 0 || normalB.w > 0 || normalC.w > 0)) {
      let boundA = d.f32(gummyCameraLayout.$.camera.absorption.w)
      let boundB = d.f32(gummyCameraLayout.$.camera.absorption.w)
      let boundC = d.f32(gummyCameraLayout.$.camera.absorption.w)
      if (normalA.w > 0) boundA = std.min(boundA, normalA.w * 0.35)
      if (normalB.w > 0) boundB = std.min(boundB, normalB.w * 0.35)
      if (normalC.w > 0) boundC = std.min(boundC, normalC.w * 0.35)
      world = gummyBoundedTearPatch(
        a,
        b,
        c,
        na,
        nb,
        nc,
        sample.xyz,
        d.vec3f(boundA, boundB, boundC),
      )
    }
  }
  if (metadata.z === 2 && gummyCameraLayout.$.camera.surface.x > 0.5) {
    const ids = gummySortedTetIds(d.vec4u(face.xyz, metadata.y - 1))
    const ta = gummyMeshLayout.$.positions[ids.x]!.xyz
    const tb = gummyMeshLayout.$.positions[ids.y]!.xyz
    const tc = gummyMeshLayout.$.positions[ids.z]!.xyz
    const tq = gummyMeshLayout.$.positions[ids.w]!.xyz
    const ra = gummyMeshLayout.$.restPositions[ids.x]!.xyz
    const rb = gummyMeshLayout.$.restPositions[ids.y]!.xyz
    const rc = gummyMeshLayout.$.restPositions[ids.z]!.xyz
    const rq = gummyMeshLayout.$.restPositions[ids.w]!.xyz
    const originalPoint = std.add(
      std.add(
        std.mul(gummyMeshLayout.$.positions[face.x]!.xyz, sample.x),
        std.mul(gummyMeshLayout.$.positions[face.y]!.xyz, sample.y),
      ),
      std.mul(gummyMeshLayout.$.positions[face.z]!.xyz, sample.z),
    )
    const orientation = std.dot(
      std.sub(rb, ra),
      std.cross(std.sub(rc, ra), std.sub(rq, ra)),
    )
    const fillet = gummyRoundedTetPoint(
      ta,
      tb,
      tc,
      tq,
      originalPoint,
      orientation,
    )
    if (fillet.valid > 0.5) {
      world = d.vec3f(fillet.position)
      normal = d.vec3f(fillet.normal)
      support = fillet.support * 2
      rest = std.add(
        std.add(std.mul(ra, fillet.bary.x), std.mul(rb, fillet.bary.y)),
        std.add(std.mul(rc, fillet.bary.z), std.mul(rq, fillet.bary.w)),
      )
    }
  }
  return {
    world,
    normal,
    visible,
    interior,
    rest,
    component: d.f32(metadata.x),
    support,
    torn: gummyTearAdjacency(metadata.w, sample.xyz),
  }
})

export const gummyVertex = tgpu.vertexFn({
  in: { corner: d.builtin.vertexIndex },
  out: surfaceOutput,
})((input) => {
  'use gpu'
  const surface = surfaceData(input.corner)
  let clip = std.mul(
    gummyCameraLayout.$.camera.viewProjection,
    d.vec4f(surface.world, 1),
  )
  if (surface.visible < 0.5) clip = d.vec4f(2, 2, 2, 1)
  return {
    position: clip,
    world: surface.world,
    normal: surface.normal,
    visible: surface.visible,
    interior: surface.interior,
    rest: surface.rest,
    component: surface.component,
    support: surface.support,
    torn: surface.torn,
  }
})
