/** GPU normals, filled-body transmission and deformation-driven floor light for the gummy study. */
import { d, std, tgpu } from 'typegpu'
import { displayColour } from '@/components/PawnBoard/pawnGlassMaterial'
import { EXPOSED_TEAR_FACE, EXTERIOR_FACE } from '@/simulation/gummy/gummyMesh'
import { gummyAbsorptionAtPoint, gummyColourAtPoint, gummyVolumeTransmission, } from './gummyBands'
import { GUMMY_FLOOR_EXTENT, GUMMY_IOR, gummyEnvironment, gummyFresnel, gummyOpticalPath, gummyTransmission, gummyUnitNormal, } from './gummyMaterial'
import { gummyBoxHit, gummyPressColour, gummyPressRimHit } from './gummyPress'
import { gummyBoundedTearPatch, gummyExitTag, gummyMatchingExit, gummyTetInradius, } from './gummyRuntimeSurfaceMath'
import { gummyCapNormal, gummyCohesiveEdgeFlatten, gummyExposedCapAreaNormal, gummyPnPosition, gummyTransportNormal, } from './gummySurfaceMath'
import { gummyTearAdjacency, gummyTearBody, gummyTearReflection, } from './gummyTearMaterial'

export const GummyCamera = d.struct({
  viewProjection: d.mat4x4f,
  inverseViewProjection: d.mat4x4f,
  eye: d.vec4f,
  resolution: d.vec4f,
  absorption: d.vec4f,
  colour: d.vec4f,
  press: d.vec4f,
})
export const gummyCameraLayout = tgpu.bindGroupLayout({
  camera: { uniform: GummyCamera },
})
export const gummyMeshLayout = tgpu.bindGroupLayout({
  positions: { storage: d.arrayOf(d.vec4f) },
  faces: { storage: d.arrayOf(d.vec4u) },
  damage: { storage: d.arrayOf(d.f32) },
  normals: { storage: d.arrayOf(d.vec4f) },
  corners: { storage: d.arrayOf(d.vec4f) },
  flatEdges: { storage: d.arrayOf(d.vec4u) },
  restPositions: { storage: d.arrayOf(d.vec4f) },
  metadata: { storage: d.arrayOf(d.vec4u) },
})
export const gummyNormalsLayout = tgpu.bindGroupLayout({
  positions: { storage: d.arrayOf(d.vec4f) },
  faces: { storage: d.arrayOf(d.vec4u) },
  restNormals: { storage: d.arrayOf(d.vec4f) },
  restPositions: { storage: d.arrayOf(d.vec4f) },
  ranges: { storage: d.arrayOf(d.vec2u) },
  adjacent: { storage: d.arrayOf(d.vec2u) },
  normals: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  damage: { storage: d.arrayOf(d.f32) },
})
export const gummySceneLayout = tgpu.bindGroupLayout({
  scene: { texture: d.texture2d(d.f32) },
  exits: { texture: d.texture2d(d.f32) },
  restExits: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})
export const gummyExitFilterLayout = tgpu.bindGroupLayout({
  fronts: { texture: d.texture2d(d.f32) },
})
export const gummyFloorLayout = tgpu.bindGroupLayout({
  light: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})
export const gummyDisplayLayout = tgpu.bindGroupLayout({
  scene: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})

/** Rest-coincident boundary triangles share normals while their nodes remain together. */
export const gummyNormalsCompute = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})((input) => {
  'use gpu'
  const id = input.gid.x
  if (id >= std.arrayLength(gummyNormalsLayout.$.positions)) return
  const position = gummyNormalsLayout.$.positions[id]!.xyz
  const range = gummyNormalsLayout.$.ranges[id]!
  let sum = d.vec3f(0)
  for (let offset = d.u32(0); offset < range.y; offset++) {
    const pair = gummyNormalsLayout.$.adjacent[range.x + offset]!
    const near = std.sub(gummyNormalsLayout.$.positions[pair.y]!.xyz, position)
    // Once fractured copies have separated, they must stop smoothing across the gap.
    if (std.dot(near, near) < 0.001225) {
      const face = gummyNormalsLayout.$.faces[pair.x]!
      const a = gummyNormalsLayout.$.positions[face.x]!.xyz
      const b = gummyNormalsLayout.$.positions[face.y]!.xyz
      const c = gummyNormalsLayout.$.positions[face.z]!.xyz
      const restA = gummyNormalsLayout.$.restPositions[face.x]!.xyz
      const restB = gummyNormalsLayout.$.restPositions[face.y]!.xyz
      const restC = gummyNormalsLayout.$.restPositions[face.z]!.xyz
      const transported = gummyTransportNormal(
        gummyNormalsLayout.$.restNormals[id]!.xyz,
        restA,
        restB,
        restC,
        a,
        b,
        c,
      )
      const area = std.length(std.cross(std.sub(b, a), std.sub(c, a)))
      sum = std.add(sum, std.mul(transported, area))
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
    const a = gummyNormalsLayout.$.positions[face.x]!.xyz
    const b = gummyNormalsLayout.$.positions[face.y]!.xyz
    const c = gummyNormalsLayout.$.positions[face.z]!.xyz
    if (face.w === 0xffffffff) {
      const transported = gummyTransportNormal(
        gummyNormalsLayout.$.restNormals[id]!.xyz,
        gummyNormalsLayout.$.restPositions[face.x]!.xyz,
        gummyNormalsLayout.$.restPositions[face.y]!.xyz,
        gummyNormalsLayout.$.restPositions[face.z]!.xyz,
        a,
        b,
        c,
      )
      const area = std.length(std.cross(std.sub(b, a), std.sub(c, a)))
      boundary = std.add(boundary, std.mul(transported, area))
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

const surfaceData = tgpu.fn(
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
  const a = gummyMeshLayout.$.positions[face.x]!.xyz
  const b = gummyMeshLayout.$.positions[face.y]!.xyz
  const c = gummyMeshLayout.$.positions[face.z]!.xyz
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
  const restA = gummyMeshLayout.$.restPositions[face.x]!.xyz
  const restB = gummyMeshLayout.$.restPositions[face.y]!.xyz
  const restC = gummyMeshLayout.$.restPositions[face.z]!.xyz
  const rest = std.add(
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

export const gummyExitFragment = tgpu.fragmentFn({
  in: { world: d.vec3f, visible: d.f32, rest: d.vec3f, component: d.f32 },
  out: { world: d.vec4f, rest: d.vec4f },
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  // Two exact integer lanes retain identity in rgba16float even beyond2048 fragments.
  const tag = gummyExitTag(input.component)
  return {
    world: d.vec4f(input.world, tag.x),
    rest: d.vec4f(input.rest, tag.y),
  }
})

/** Select the nearest visible component before collecting its back surface. */
export const gummyFrontTagFragment = tgpu.fragmentFn({
  in: { visible: d.f32, component: d.f32 },
  out: d.vec4f,
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  return d.vec4f(gummyExitTag(input.component), 0, 1)
})

/** Other fragments must not replace this pixel's own back exit and optical thickness. */
export const gummyRuntimeExitFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    visible: d.f32,
    rest: d.vec3f,
    component: d.f32,
    pixel: d.builtin.position,
  },
  out: { world: d.vec4f, rest: d.vec4f },
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  const front = std.textureLoad(
    gummyExitFilterLayout.$.fronts,
    d.vec2i(input.pixel.xy),
    0,
  )
  if (!gummyMatchingExit(input.component, front.xy, 1)) std.discard()
  const tag = gummyExitTag(input.component)
  return {
    world: d.vec4f(input.world, tag.x),
    rest: d.vec4f(input.rest, tag.y),
  }
})

export const gummyFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    normal: d.vec3f,
    visible: d.f32,
    interior: d.f32,
    pixel: d.builtin.position,
    rest: d.vec3f,
    component: d.f32,
    support: d.f32,
    torn: d.f32,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const geometricArea = std.cross(std.dpdx(input.world), std.dpdy(input.world))
  if (input.visible < 0.5) std.discard()
  const normal = gummyUnitNormal(input.normal, d.vec3f(0, 1, 0))
  const view = std.normalize(
    std.sub(gummyCameraLayout.$.camera.eye.xyz, input.world),
  )
  const incident = std.neg(view)
  const noV = std.max(std.dot(normal, view), 0.005)
  const light = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  const noL = std.max(std.dot(normal, light), 0)
  const fresnel = gummyFresnel(noV)
  const reflected = gummyEnvironment(std.reflect(incident, normal))
  const mode = gummyCameraLayout.$.camera.colour.w
  const dye = gummyColourAtPoint(
    input.rest,
    mode,
    gummyCameraLayout.$.camera.colour.xyz,
  )
  const diagnostic = gummyCameraLayout.$.camera.eye.w
  if (diagnostic > 0.5 && diagnostic < 1.5) return d.vec4f(dye, 1)
  if (diagnostic > 1.5 && diagnostic < 2.5) {
    if (input.interior > 0.5) return d.vec4f(0.01, 0.7, 0.8, 1)
    return d.vec4f(0.8, 0.025, 0.01, 1)
  }
  if (diagnostic > 3.5 && diagnostic < 4.5) {
    let geometric = gummyUnitNormal(geometricArea, normal)
    if (std.dot(geometric, view) < 0) geometric = std.neg(geometric)
    if (std.dot(normal, geometric) < 0) return d.vec4f(1, 0, 1, 1)
    if (std.dot(normal, view) < 0) return d.vec4f(1, 1, 0, 1)
    return d.vec4f(0.015, 0.4, 0.02, 1)
  }
  if (gummyCameraLayout.$.camera.resolution.z > 0.5) {
    const clay = std.mul(dye, 0.3 + 0.7 * noL)
    return d.vec4f(std.add(clay, std.mul(reflected, fresnel * 0.12)), 1)
  }
  const uv = std.div(input.pixel.xy, gummyCameraLayout.$.camera.resolution.xy)
  const exit = std.textureLoad(
    gummySceneLayout.$.exits,
    d.vec2i(input.pixel.xy),
    0,
  )
  const rayPath = std.dot(std.sub(exit.xyz, input.world), incident)
  const exitRest = std.textureLoad(
    gummySceneLayout.$.restExits,
    d.vec2i(input.pixel.xy),
    0,
  )
  let restEnd = d.vec3f(input.rest)
  const matchingExit = gummyMatchingExit(
    input.component,
    d.vec2f(exit.w, exitRest.w),
    rayPath,
  )
  if (diagnostic > 4.5 && diagnostic < 5.5) {
    if (matchingExit) return d.vec4f(0.01, 0.7, 0.02, 1)
    if (exit.w <= 0) return d.vec4f(0.01, 0.02, 0.8, 1)
    if (rayPath <= 0) return d.vec4f(0.8, 0.7, 0.01, 1)
    return d.vec4f(0.8, 0.01, 0.02, 1)
  }
  if (matchingExit) restEnd = d.vec3f(exitRest.xyz)
  let thickness = d.f32(0.04)
  if (input.support > 0) thickness = std.clamp(input.support, 0.0001, 2.4)
  if (matchingExit) thickness = std.clamp(rayPath, 0.015, 2.4)
  const inside = std.refract(incident, normal, 1 / GUMMY_IOR)
  // A screen-space approximation: measured body thickness bends a probe through
  // the volume. It cannot reconstruct occluded geometry or multiple ray exits.
  const path = gummyOpticalPath(
    thickness,
    noV,
    std.dot(inside, normal),
    input.interior,
  )
  if (diagnostic > 5.5 && diagnostic < 6.5) {
    const grey = std.clamp(path, 0, 1)
    return d.vec4f(grey, grey, grey, 1)
  }
  const probe = std.add(input.world, std.mul(inside, path))
  const clip = std.mul(
    gummyCameraLayout.$.camera.viewProjection,
    d.vec4f(probe, 1),
  )
  let sampleUv = d.vec2f(uv)
  if (clip.w > 0.001) {
    const projected = std.add(
      std.mul(std.div(clip.xy, clip.w), d.vec2f(0.5, -0.5)),
      d.vec2f(0.5),
    )
    sampleUv = std.clamp(projected, d.vec2f(0.002), d.vec2f(0.998))
  }
  const scene = std.textureSampleLevel(
    gummySceneLayout.$.scene,
    gummySceneLayout.$.sampler,
    sampleUv,
    0,
  ).xyz
  const absorption = gummyVolumeTransmission(
    input.rest,
    restEnd,
    path,
    mode,
    gummyCameraLayout.$.camera.absorption.xyz,
  )
  const transmitted = std.mul(scene, absorption)
  // Soft coloured in-scattering approximates a short diffusion path. The mesh
  // geometry supplies the face and silhouette; this term never changes shape.
  const scattering = std.mul(
    dye,
    (0.035 + 0.09 * noL + 0.06 * std.pow(1 - noV, 2)) *
      (1 - std.exp(-path * 3)),
  )
  let body = std.add(transmitted, scattering)
  // After a crack, inherited skin and new caps meet on the same thin piece.
  // Carry its wet surface pigment across that real adjacency instead of giving
  // the inherited side neutral transmission while its cap remains strongly dyed.
  // This appearance term leaves untouched bulk optics and optical path unchanged.
  if (input.interior < 0.5 && input.torn > 0)
    body = std.mix(body, gummyTearBody(body, dye, noL), input.torn)
  let colour = std.add(std.mul(body, 1 - fresnel), std.mul(reflected, fresnel))
  if (diagnostic > 2.5 && diagnostic < 3.5) colour = d.vec3f(body)
  if (input.interior > 0.5) {
    // Torn gel has a rough, dyed surface, rather than a polished glass cut.
    // This broad reflection and local scattering are an appearance approximation;
    // transmission above still uses the measured volume and material coordinates.
    let roughReflection = std.mix(reflected, gummyEnvironment(normal), 0.65)
    // Runtime cuts have real component metadata. Their rough lobe follows the
    // reflection ray; legacy cohesive caps retain their original material.
    let tornBody = std.mix(body, std.mul(dye, 0.5 + 0.5 * noL), 0.7)
    if (input.component > 0.5) {
      roughReflection = gummyTearReflection(std.reflect(incident, normal))
      tornBody = gummyTearBody(body, dye, noL)
    }
    const roughFresnel = gummyFresnel(0.25 + 0.75 * noV)
    colour = std.add(
      std.mul(tornBody, 1 - roughFresnel),
      std.mul(roughReflection, roughFresnel),
    )
    if (diagnostic > 2.5 && diagnostic < 3.5) colour = d.vec3f(tornBody)
  }
  return d.vec4f(colour, 1)
})

const floorOutput = {
  position: d.builtin.position,
  world: d.vec3f,
  normal: d.vec3f,
  visible: d.f32,
  rest: d.vec3f,
}
const floorProjection = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((point, direction) => {
  'use gpu'
  const travel = std.max(point.y, 0.001) / std.max(-direction.y, 0.12)
  return std.add(point, std.mul(direction, travel))
})

export const gummyCausticVertex = tgpu.vertexFn({
  in: { corner: d.builtin.vertexIndex },
  out: floorOutput,
})((input) => {
  'use gpu'
  const surface = surfaceData(input.corner)
  const incident = std.neg(std.normalize(d.vec3f(-0.42, 0.87, 0.26)))
  const normal = gummyUnitNormal(surface.normal, d.vec3f(0, 1, 0))
  const refracted = std.refract(incident, normal, 1 / GUMMY_IOR)
  const floor = floorProjection(surface.world, refracted)
  let clip = d.vec4f(
    floor.x / GUMMY_FLOOR_EXTENT,
    -floor.z / GUMMY_FLOOR_EXTENT,
    0.5,
    1,
  )
  let visible = d.f32(surface.visible)
  if (std.dot(normal, std.neg(incident)) < 0.04 || surface.interior > 0.5)
    visible = 0
  if (visible < 0.5) clip = d.vec4f(2, 2, 2, 1)
  return {
    position: clip,
    world: surface.world,
    normal,
    visible,
    rest: surface.rest,
  }
})

export const gummyCausticFragment = tgpu.fragmentFn({
  in: { world: d.vec3f, normal: d.vec3f, visible: d.f32, rest: d.vec3f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  // Rasterized area compression measures focusing by the simulated surface.
  // This is a single-interface projection, not a two-interface photon tracer.
  const area = std.length(
    std.cross(std.dpdx(input.world), std.dpdy(input.world)),
  )
  const focusing = std.clamp(
    (area * (512 * 512)) / (4 * GUMMY_FLOOR_EXTENT * GUMMY_FLOOR_EXTENT),
    0,
    8,
  )
  const normal = gummyUnitNormal(input.normal, d.vec3f(0, 1, 0))
  const incident = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  const flux = std.max(std.dot(normal, incident), 0)
  const transmission = gummyTransmission(
    gummyAbsorptionAtPoint(
      input.rest,
      gummyCameraLayout.$.camera.colour.w,
      gummyCameraLayout.$.camera.absorption.xyz,
    ),
    0.45,
  )
  return d.vec4f(std.mul(transmission, flux * focusing * 0.055), 0)
})

export const gummyShadowVertex = tgpu.vertexFn({
  in: { corner: d.builtin.vertexIndex },
  out: floorOutput,
})((input) => {
  'use gpu'
  const surface = surfaceData(input.corner)
  const floor = floorProjection(
    surface.world,
    std.neg(std.normalize(d.vec3f(-0.42, 0.87, 0.26))),
  )
  let clip = d.vec4f(
    floor.x / GUMMY_FLOOR_EXTENT,
    -floor.z / GUMMY_FLOOR_EXTENT,
    0.5,
    1,
  )
  if (surface.visible < 0.5) clip = d.vec4f(2, 2, 2, 1)
  return {
    position: clip,
    world: surface.world,
    normal: surface.normal,
    visible: surface.visible,
    rest: surface.rest,
  }
})
export const gummyShadowFragment = tgpu.fragmentFn({
  in: { visible: d.f32 },
  out: d.vec4f,
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  return d.vec4f(0, 0, 0, 0.18)
})

export const gummyBackgroundFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: { colour: d.vec4f, depth: d.builtin.fragDepth },
})((input) => {
  'use gpu'
  const ndc = d.vec4f(input.uv.x * 2 - 1, 1 - input.uv.y * 2, 1, 1)
  const far = std.mul(gummyCameraLayout.$.camera.inverseViewProjection, ndc)
  const ray = std.normalize(
    std.sub(std.div(far.xyz, far.w), gummyCameraLayout.$.camera.eye.xyz),
  )
  let colour = std.mix(
    d.vec3f(0.68, 0.62, 0.53),
    d.vec3f(0.83, 0.8, 0.74),
    std.smoothstep(-0.2, 0.6, ray.y),
  )
  let depth = d.f32(1)
  if (ray.y < -0.001) {
    const t = -gummyCameraLayout.$.camera.eye.y / ray.y
    if (t > 0) {
      const world = std.add(gummyCameraLayout.$.camera.eye.xyz, std.mul(ray, t))
      const clip = std.mul(
        gummyCameraLayout.$.camera.viewProjection,
        d.vec4f(world, 1),
      )
      depth = std.clamp(clip.z / clip.w, 0, 1)
      const floorUv = std.add(
        std.div(world.xz, 2 * GUMMY_FLOOR_EXTENT),
        d.vec2f(0.5),
      )
      let light = d.vec4f(0)
      if (floorUv.x > 0 && floorUv.x < 1 && floorUv.y > 0 && floorUv.y < 1) {
        for (const x of std.range(-1, 2)) {
          for (const y of std.range(-1, 2)) {
            light = std.add(
              light,
              std.textureSampleLevel(
                gummyFloorLayout.$.light,
                gummyFloorLayout.$.sampler,
                std.add(floorUv, std.mul(d.vec2f(d.f32(x), d.f32(y)), 0.0039)),
                0,
              ),
            )
          }
        }
        light = std.div(light, 9)
      }
      const visibility = 1 - std.clamp(light.w, 0, 0.38)
      colour = std.add(
        std.mul(d.vec3f(0.72, 0.65, 0.55), visibility),
        std.min(light.xyz, d.vec3f(0.7)),
      )
    }
  }
  const press = gummyCameraLayout.$.camera.press
  if (press.z > 0.5) {
    const hit = gummyPressRimHit(gummyCameraLayout.$.camera.eye.xyz, ray, press)
    if (hit.w >= 0) {
      const world = std.add(
        gummyCameraLayout.$.camera.eye.xyz,
        std.mul(ray, hit.w),
      )
      const clip = std.mul(
        gummyCameraLayout.$.camera.viewProjection,
        d.vec4f(world, 1),
      )
      const plateDepth = clip.z / clip.w
      if (plateDepth >= 0 && plateDepth < depth) {
        depth = plateDepth
        colour = gummyPressColour(hit.xyz, ray)
      }
    }
  }
  return { colour: d.vec4f(colour, 1), depth }
})

export const gummyDisplayFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  let colour = d.vec3f(
    std.textureSampleLevel(
      gummyDisplayLayout.$.scene,
      gummyDisplayLayout.$.sampler,
      input.uv,
      0,
    ).xyz,
  )
  const press = gummyCameraLayout.$.camera.press
  if (press.z > 0.5) {
    const far = std.mul(
      gummyCameraLayout.$.camera.inverseViewProjection,
      d.vec4f(input.uv.x * 2 - 1, 1 - input.uv.y * 2, 1, 1),
    )
    const ray = std.normalize(
      std.sub(std.div(far.xyz, far.w), gummyCameraLayout.$.camera.eye.xyz),
    )
    const hit = gummyBoxHit(
      gummyCameraLayout.$.camera.eye.xyz,
      ray,
      d.vec3f(-press.y, press.x, -press.y),
      d.vec3f(press.y, press.x + press.w, press.y),
    )
    if (hit.w >= 0 && std.abs(hit.y) > 0.5) {
      const world = std.add(
        gummyCameraLayout.$.camera.eye.xyz,
        std.mul(ray, hit.w),
      )
      if (
        std.abs(world.x) < press.y - 0.035 &&
        std.abs(world.z) < press.y - 0.035
      ) {
        // A lightly reflecting inspection window; keep the deforming material visible below it.
        const reflection = std.min(
          gummyEnvironment(std.reflect(ray, hit.xyz)),
          d.vec3f(2),
        )
        const fresnel = 0.025 + 0.12 * std.pow(1 - std.abs(ray.y), 5)
        colour = std.mix(
          std.mul(colour, d.vec3f(0.98, 0.995, 1)),
          reflection,
          fresnel,
        )
      }
    }
  }
  return d.vec4f(
    displayColour(colour, gummyCameraLayout.$.camera.resolution.w),
    1,
  )
})
