/** Mesh-driven floor caustics and shadows; a bounded single-interface projection, not a photon solver. */
import { d, std, tgpu } from 'typegpu'
import { gummyAbsorptionAtPoint } from './gummyBands'
import { GUMMY_FLOOR_EXTENT, GUMMY_IOR, gummyFresnel, gummyTransmission, gummyUnitNormal, } from './gummyMaterial'
import { gummyCameraLayout } from './gummyShaders'
import { marchingGummyMeshLayout } from './marchingGummyRenderShaders'

/** Project only downward rays. The fourth component is validity, never optical thickness. */
export const marchingGummyFloorProjection = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec4f,
)((point, direction) => {
  'use gpu'
  if (direction.y >= -0.05 || point.y < 0) return d.vec4f(0)
  const distance = point.y / -direction.y
  const floor = std.add(point, std.mul(direction, distance))
  return d.vec4f(floor.x, 0, floor.z, 1)
})

/** Reject every corner of a floor-crossing triangle together; clipping one corner creates a long shadow wedge. */
export const marchingGummyShadowTriangleProjection = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.u32],
  d.vec4f,
)((a, b, c, corner) => {
  'use gpu'
  if (std.min(a.y, std.min(b.y, c.y)) < 0) return d.vec4f(0)
  let point = d.vec3f(a)
  if (corner === 1) point = d.vec3f(b)
  if (corner === 2) point = d.vec3f(c)
  return marchingGummyFloorProjection(
    point,
    std.neg(std.normalize(d.vec3f(-0.42, 0.87, 0.26))),
  )
})

/** The cap discards excess focal energy instead of brightening collapsed or empty triangles. */
export const marchingGummyFlux = tgpu.fn(
  [d.f32, d.f32],
  d.f32,
)((incomingArea, floorArea) => {
  'use gpu'
  if (incomingArea <= 0 || floorArea <= 0.00000001) return 0
  return std.min(incomingArea / floorArea, 8)
})

const lightOutput = {
  position: d.builtin.position,
  rest: d.vec3f,
  flux: d.f32,
  path: d.f32,
}

/** Each triangle transports its incident flux to the refracted footprint of its smooth mesh normals. */
export const marchingGummyLightVertex = tgpu.vertexFn({
  in: { corner: d.builtin.vertexIndex },
  out: lightOutput,
})(({ corner }) => {
  'use gpu'
  const base = corner - (corner % 3)
  const a = marchingGummyMeshLayout.$.vertices[base]!
  const b = marchingGummyMeshLayout.$.vertices[base + 1]!
  const c = marchingGummyMeshLayout.$.vertices[base + 2]!
  const vertex = marchingGummyMeshLayout.$.vertices[corner]!
  const light = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  const incident = std.neg(light)
  const na = gummyUnitNormal(a.normal.xyz, d.vec3f(0, 1, 0))
  const nb = gummyUnitNormal(b.normal.xyz, na)
  const nc = gummyUnitNormal(c.normal.xyz, na)
  const fa = marchingGummyFloorProjection(
    a.position.xyz,
    std.refract(incident, na, 1 / GUMMY_IOR),
  )
  const fb = marchingGummyFloorProjection(
    b.position.xyz,
    std.refract(incident, nb, 1 / GUMMY_IOR),
  )
  const fc = marchingGummyFloorProjection(
    c.position.xyz,
    std.refract(incident, nc, 1 / GUMMY_IOR),
  )
  const normal = gummyUnitNormal(std.add(std.add(na, nb), nc), na)
  let area = std.cross(
    std.sub(b.position.xyz, a.position.xyz),
    std.sub(c.position.xyz, a.position.xyz),
  )
  // The density gradient defines outside even when a lookup-table triangle has opposite winding.
  if (std.dot(area, normal) < 0) area = std.neg(area)
  const incomingArea = std.max(std.dot(area, light), 0)
  const floorArea = std.abs(
    std.cross(std.sub(fb.xyz, fa.xyz), std.sub(fc.xyz, fa.xyz)).y,
  )
  const cosine = std.max(std.dot(normal, light), 0)
  let flux = marchingGummyFlux(incomingArea, floorArea)
  flux *= 1 - gummyFresnel(cosine)
  let floor = d.vec4f(fa)
  if (corner % 3 === 1) floor = d.vec4f(fb)
  if (corner % 3 === 2) floor = d.vec4f(fc)
  let clip = d.vec4f(
    floor.x / GUMMY_FLOOR_EXTENT,
    -floor.z / GUMMY_FLOOR_EXTENT,
    0.5,
    1,
  )
  if (fa.w * fb.w * fc.w < 0.5 || cosine < 0.04 || flux <= 0) {
    clip = d.vec4f(2, 2, 2, 1)
    flux = 0
  }
  const inside = std.refract(incident, normal, 1 / GUMMY_IOR)
  // Local absorbing slab only: neither height above the floor nor empty air adds absorption.
  const path = std.clamp(
    0.35 / std.max(-std.dot(inside, normal), 0.2),
    0.1,
    1.4,
  )
  return { position: clip, rest: vertex.rest.xyz, flux, path }
})

export const marchingGummyLightFragment = tgpu.fragmentFn({
  in: { rest: d.vec3f, flux: d.f32, path: d.f32 },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const transmission = gummyTransmission(
    gummyAbsorptionAtPoint(input.rest, camera.colour.w, camera.absorption.xyz),
    input.path,
  )
  return d.vec4f(std.mul(transmission, input.flux * 0.085), 0)
})

export const marchingGummyShadowVertex = tgpu.vertexFn({
  in: { corner: d.builtin.vertexIndex },
  out: {
    position: d.builtin.position,
    rest: d.vec3f,
    normal: d.vec3f,
  },
})(({ corner }) => {
  'use gpu'
  const vertex = marchingGummyMeshLayout.$.vertices[corner]!
  const base = corner - (corner % 3)
  const floor = marchingGummyShadowTriangleProjection(
    marchingGummyMeshLayout.$.vertices[base]!.position.xyz,
    marchingGummyMeshLayout.$.vertices[base + 1]!.position.xyz,
    marchingGummyMeshLayout.$.vertices[base + 2]!.position.xyz,
    corner % 3,
  )
  let clip = d.vec4f(
    floor.x / GUMMY_FLOOR_EXTENT,
    -floor.z / GUMMY_FLOOR_EXTENT,
    0.5,
    1,
  )
  if (floor.w < 0.5) clip = d.vec4f(2, 2, 2, 1)
  return { position: clip, rest: vertex.rest.xyz, normal: vertex.normal.xyz }
})

export const marchingGummyShadowFragment = tgpu.fragmentFn({
  in: { rest: d.vec3f, normal: d.vec3f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const normal = gummyUnitNormal(input.normal, d.vec3f(0, 1, 0))
  const light = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  // Only entry-facing surface patches cast; a closed shell must not double its own shadow.
  if (std.dot(normal, light) <= 0.04) std.discard()
  const camera = gummyCameraLayout.$.camera
  const transmission = gummyTransmission(
    gummyAbsorptionAtPoint(input.rest, camera.colour.w, camera.absorption.xyz),
    0.35,
  )
  const mean = (transmission.x + transmission.y + transmission.z) / 3
  return d.vec4f(0, 0, 0, 0.08 + 0.2 * (1 - mean))
})
