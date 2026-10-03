/** Curved exterior refinement driven entirely by current simulated nodes and transported normals. */
import { d, std, tgpu } from 'typegpu'
import { gummyUnitNormal } from './gummyMaterial'

/** A still-cohesive interface must not turn an intact smooth boundary into a flat cap edge. */
export const gummyCohesiveEdgeFlatten = tgpu.fn(
  [d.f32],
  d.f32,
)((damage) => {
  'use gpu'
  return std.select(d.f32(0), d.f32(1), damage >= 1)
})

/** Only released cohesive faces contribute to a fragment's exposed-boundary normal. */
export const gummyExposedCapAreaNormal = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.f32],
  d.vec3f,
)((a, b, c, damage) => {
  'use gpu'
  if (damage < 1) return d.vec3f(0)
  return std.cross(std.sub(b, a), std.sub(c, a))
})

/** Concave corner averages must remain on the rendered face's outward hemisphere. */
export const gummyCapNormal = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((average, areaNormal) => {
  'use gpu'
  const geometric = gummyUnitNormal(areaNormal, d.vec3f(0, 1, 0))
  const smooth = gummyUnitNormal(average, geometric)
  if (std.dot(smooth, geometric) <= 0) return d.vec3f(geometric)
  return d.vec3f(smooth)
})

/** Cofactor normal transport on a deformed triangle, preserving its analytic rest normal. */
export const gummyTransportNormal = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f],
  d.vec3f,
)((normal, restA, restB, restC, a, b, c) => {
  'use gpu'
  const restU = std.sub(restB, restA)
  const restV = std.sub(restC, restA)
  const length = std.max(std.length(restU), 0.000001)
  const x = std.div(restU, length)
  const z = gummyUnitNormal(std.cross(restU, restV), normal)
  const y = std.cross(z, x)
  const j1 = std.div(std.sub(b, a), length)
  const j2 = std.div(
    std.sub(std.sub(c, a), std.mul(j1, std.dot(restV, x))),
    std.max(std.dot(restV, y), 0.000001),
  )
  const j3 = gummyUnitNormal(std.cross(j1, j2), z)
  const nx = std.mul(std.cross(j2, j3), std.dot(normal, x))
  const ny = std.mul(std.cross(j3, j1), std.dot(normal, y))
  const nz = std.mul(std.cross(j1, j2), std.dot(normal, z))
  return gummyUnitNormal(std.add(std.add(nx, ny), nz), j3)
})

const pnEdge = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f],
  d.vec3f,
)((a, b, normal) => {
  'use gpu'
  return std.div(
    std.sub(
      std.add(std.mul(a, 2), b),
      std.mul(normal, std.dot(std.sub(b, a), normal)),
    ),
    3,
  )
})

/** Cubic PN triangle (Vlachos et al., https://alex.vlachos.com/graphics/CurvedPNTriangles.pdf).
 * Shared edge curves preserve adjacent patches without changing physics. */
export const gummyPnPosition = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f],
  d.vec3f,
)((a, b, c, na, nb, nc, bary, flatEdges) => {
  'use gpu'
  const ab = std.mix(
    pnEdge(a, b, na),
    std.div(std.add(std.mul(a, 2), b), 3),
    flatEdges.x,
  )
  const ba = std.mix(
    pnEdge(b, a, nb),
    std.div(std.add(std.mul(b, 2), a), 3),
    flatEdges.x,
  )
  const bc = std.mix(
    pnEdge(b, c, nb),
    std.div(std.add(std.mul(b, 2), c), 3),
    flatEdges.y,
  )
  const cb = std.mix(
    pnEdge(c, b, nc),
    std.div(std.add(std.mul(c, 2), b), 3),
    flatEdges.y,
  )
  const ca = std.mix(
    pnEdge(c, a, nc),
    std.div(std.add(std.mul(c, 2), a), 3),
    flatEdges.z,
  )
  const ac = std.mix(
    pnEdge(a, c, na),
    std.div(std.add(std.mul(a, 2), c), 3),
    flatEdges.z,
  )
  const edge = std.div(
    std.add(std.add(std.add(ab, ba), std.add(bc, cb)), std.add(ca, ac)),
    6,
  )
  const centre = std.div(std.add(std.add(a, b), c), 3)
  const middle = std.add(edge, std.mul(std.sub(edge, centre), 0.5))
  const u = bary.x
  const v = bary.y
  const w = bary.z
  let point = std.add(
    std.add(std.mul(a, u * u * u), std.mul(b, v * v * v)),
    std.mul(c, w * w * w),
  )
  point = std.add(point, std.mul(ab, 3 * u * u * v))
  point = std.add(point, std.mul(ba, 3 * v * v * u))
  point = std.add(point, std.mul(bc, 3 * v * v * w))
  point = std.add(point, std.mul(cb, 3 * w * w * v))
  point = std.add(point, std.mul(ca, 3 * w * w * u))
  point = std.add(point, std.mul(ac, 3 * u * u * w))
  return std.add(point, std.mul(middle, 6 * u * v * w))
})
