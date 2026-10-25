/** Inscribed spherical fillets for isolated tetrahedral chips, with material-coordinate transport. */
import { d, std, tgpu } from 'typegpu'

/** Canonical vertex order makes every face evaluate shared edges with identical arithmetic. */
export const gummySortedTetIds = tgpu.fn(
  [d.vec4u],
  d.vec4u,
)((ids) => {
  'use gpu'
  const a = std.min(ids.x, ids.y)
  const b = std.max(ids.x, ids.y)
  const c = std.min(ids.z, ids.w)
  const q = std.max(ids.z, ids.w)
  const low = std.min(a, c)
  const middleA = std.max(a, c)
  const middleB = std.min(b, q)
  const high = std.max(b, q)
  return d.vec4u(
    low,
    std.min(middleA, middleB),
    std.max(middleA, middleB),
    high,
  )
})

const closestSegment = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f],
  d.vec3f,
)((p, a, b) => {
  'use gpu'
  const edge = std.sub(b, a)
  const t = std.clamp(
    std.dot(std.sub(p, a), edge) / std.max(std.dot(edge, edge), 1e-30),
    0,
    1,
  )
  return std.add(a, std.mul(edge, t))
})

/** Plane projection plus edge distance avoids cancelling Gram determinants on skinny faces. */
const closestTriangle = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f],
  d.vec3f,
)((p, a, b, c) => {
  'use gpu'
  const ab = std.sub(b, a)
  const ac = std.sub(c, a)
  const normal = std.cross(ab, ac)
  const square = std.dot(normal, normal)
  const ap = std.sub(p, a)
  const projected = std.sub(
    p,
    std.mul(normal, std.dot(ap, normal) / std.max(square, 1e-30)),
  )
  const fromA = std.sub(projected, a)
  const v = std.dot(std.cross(fromA, ac), normal) / std.max(square, 1e-30)
  const w = std.dot(std.cross(ab, fromA), normal) / std.max(square, 1e-30)
  if (square > 0 && v >= 0 && w >= 0 && v + w <= 1) return d.vec3f(projected)
  let closest = closestSegment(p, a, b)
  let squareDistance = std.dot(std.sub(p, closest), std.sub(p, closest))
  const sides = d.arrayOf(
    d.vec3f,
    2,
  )([closestSegment(p, a, c), closestSegment(p, b, c)])
  for (let side = d.u32(0); side < 2; side++) {
    const next = sides[side]!
    const delta = std.sub(p, next)
    const distance = std.dot(delta, delta)
    if (distance < squareDistance) {
      closest = d.vec3f(next)
      squareDistance = distance
    }
  }
  return d.vec3f(closest)
})

export const gummyRoundedTetPoint = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.f32],
  d.struct({
    position: d.vec3f,
    normal: d.vec3f,
    bary: d.vec4f,
    support: d.f32,
    valid: d.f32,
  }),
)((a, b, c, q, point, restOrientation) => {
  'use gpu'
  const ab = std.sub(b, a)
  const ac = std.sub(c, a)
  const aq = std.sub(q, a)
  const determinant = std.dot(ab, std.cross(ac, aq))
  const aa = std.length(std.cross(std.sub(c, b), std.sub(q, b)))
  const ba = std.length(std.cross(ac, aq))
  const ca = std.length(std.cross(ab, aq))
  const qa = std.length(std.cross(ab, ac))
  const area = aa + ba + ca + qa
  const radius = std.abs(determinant) / std.max(area, 0.000000000001)
  if (determinant * restOrientation <= 0 || radius <= 0.0000001)
    return {
      position: d.vec3f(point),
      normal: d.vec3f(0),
      bary: d.vec4f(0),
      support: d.f32(0),
      valid: d.f32(0),
    }
  const center = std.div(
    std.add(
      std.add(std.mul(a, aa), std.mul(b, ba)),
      std.add(std.mul(c, ca), std.mul(q, qa)),
    ),
    area,
  )
  const ia = std.mix(a, center, 0.3)
  const ib = std.mix(b, center, 0.3)
  const ic = std.mix(c, center, 0.3)
  const iq = std.mix(q, center, 0.3)
  let closest = closestTriangle(point, ia, ib, ic)
  let distance2 = std.dot(std.sub(point, closest), std.sub(point, closest))
  const sides = d.arrayOf(
    d.vec3f,
    3,
  )([
    closestTriangle(point, ia, ib, iq),
    closestTriangle(point, ia, ic, iq),
    closestTriangle(point, ib, ic, iq),
  ])
  for (let side = d.u32(0); side < 3; side++) {
    const candidate = sides[side]!
    const delta = std.sub(point, candidate)
    const next = std.dot(delta, delta)
    if (next < distance2) {
      closest = d.vec3f(candidate)
      distance2 = next
    }
  }
  const direction = std.div(
    std.sub(point, closest),
    std.sqrt(std.max(distance2, 1e-30)),
  )
  const position = std.add(closest, std.mul(direction, radius * 0.3))
  const fromA = std.sub(position, a)
  const y = std.dot(fromA, std.cross(ac, aq)) / determinant
  const z = std.dot(ab, std.cross(fromA, aq)) / determinant
  const w = std.dot(ab, std.cross(ac, fromA)) / determinant
  return {
    position,
    normal: direction,
    bary: d.vec4f(1 - y - z - w, y, z, w),
    support: radius,
    valid: d.f32(1),
  }
})
