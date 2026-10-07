/** Prescribed rook contact: the exact mould boundary, unilateral velocity response and bounded cleanup. */
import { d, std, tgpu } from 'typegpu'
import { GUMMY_ROOK_BLEND, GUMMY_ROOK_EDGE_RADIUS, GUMMY_ROOK_MERLON_RADIUS, GUMMY_ROOK_MERLONS, GUMMY_ROOK_PROFILE, } from './gummyChessMoulds'

export type GummyRookCollider = {
  /** Rook base translation at the beginning of this admitted step batch. */
  position: readonly [number, number, number]
  /** Prescribed linear velocity in simulation units/second. */
  velocity: readonly [number, number, number]
  friction?: number
}

export function normalizeGummyRookCollider(collider?: GummyRookCollider) {
  if (!collider) return undefined
  if (![...collider.position, ...collider.velocity].every(Number.isFinite))
    throw new RangeError('Rook collider position and velocity must be finite')
  if (collider.position.some((value) => Math.abs(value) > 10000))
    throw new RangeError(
      'Rook collider position exceeds the supported scene bounds',
    )
  if (Math.hypot(...collider.velocity) > 32)
    throw new RangeError(
      'Rook collider speed must not exceed 32 units per second',
    )
  const friction = collider.friction ?? 0.35
  if (!Number.isFinite(friction))
    throw new RangeError('Rook collider friction must be finite')
  return {
    position: collider.position,
    velocity: collider.velocity,
    friction: Math.max(0, Math.min(1, friction)),
  }
}

const profilePoint = tgpu.comptime((index: number) => {
  const point = GUMMY_ROOK_PROFILE[index]!
  return d.vec2f(point[0], point[1])
})
const previousProfilePoint = tgpu.comptime((index: number) => {
  const point =
    GUMMY_ROOK_PROFILE[
      (index + GUMMY_ROOK_PROFILE.length - 1) % GUMMY_ROOK_PROFILE.length
    ]!
  return d.vec2f(point[0], point[1])
})
const merlonCenter = tgpu.comptime((index: number) => {
  const point = GUMMY_ROOK_MERLONS[index]!.center
  return d.vec3f(point[0], point[1], point[2])
})
const merlonHalf = tgpu.comptime((index: number) => {
  const point = GUMMY_ROOK_MERLONS[index]!.half
  return d.vec3f(point[0], point[1], point[2])
})

// A smooth union can extend its inputs by at most blend / 4 per application.
// Derive the broad phase from the mould, so future profile edits cannot omit contacts.
const smoothMargin = (GUMMY_ROOK_MERLONS.length * GUMMY_ROOK_BLEND) / 4
const contactRadius =
  Math.max(
    ...GUMMY_ROOK_PROFILE.map(([radius]) => radius + GUMMY_ROOK_EDGE_RADIUS),
    ...GUMMY_ROOK_MERLONS.flatMap(({ center, half }) => [
      Math.abs(center[0]) + half[0],
      Math.abs(center[2]) + half[2],
    ]),
  ) + smoothMargin
const contactMinY =
  Math.min(
    ...GUMMY_ROOK_PROFILE.map(([, height]) => height - GUMMY_ROOK_EDGE_RADIUS),
    ...GUMMY_ROOK_MERLONS.map(({ center, half }) => center[1] - half[1]),
  ) - smoothMargin
const contactMaxY =
  Math.max(
    ...GUMMY_ROOK_PROFILE.map(([, height]) => height + GUMMY_ROOK_EDGE_RADIUS),
    ...GUMMY_ROOK_MERLONS.map(({ center, half }) => center[1] + half[1]),
  ) + smoothMargin

/** Conservative local-space rejection before the exact profile and crown evaluation. */
export const gummyRookMayContact = (point: d.v3f, radius: number) => {
  'use gpu'
  return (
    std.abs(point.x) <= contactRadius + radius &&
    std.abs(point.z) <= contactRadius + radius &&
    point.y >= contactMinY - radius &&
    point.y <= contactMaxY + radius
  )
}

/** xyz is the analytic field gradient; w is signed distance before smooth unions. */
const rookLatheContact = (point: d.v3f) => {
  'use gpu'
  const radial = std.length(point.xz)
  const p = d.vec2f(radial, point.y)
  let nearest = d.vec2f(0, -1)
  let squared = d.f32(1000000)
  let inside = false
  for (const i of tgpu.unroll(std.range(GUMMY_ROOK_PROFILE.length))) {
    const a = profilePoint(i)
    const b = previousProfilePoint(i)
    const edge = std.sub(b, a)
    const offset = std.sub(p, a)
    const t = std.clamp(std.dot(offset, edge) / std.dot(edge, edge), 0, 1)
    const delta = std.sub(offset, std.mul(edge, t))
    const distanceSquared = std.dot(delta, delta)
    // The profile's axis closes a 2D polygon, but is not a boundary of the filled 3D solid.
    if ((a.x > 0 || b.x > 0) && distanceSquared < squared) {
      squared = distanceSquared
      nearest = d.vec2f(delta)
    }
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * edge.x) / edge.y)
      inside = !inside
  }
  const sign = std.select(d.f32(1), d.f32(-1), inside)
  const length = std.sqrt(squared)
  const gradient = std.mul(nearest, sign / std.max(length, 0.000001))
  let radialDirection = d.vec2f(1, 0)
  if (radial > 0.000001) radialDirection = std.div(point.xz, radial)
  return d.vec4f(
    gradient.x * radialDirection.x,
    gradient.y,
    gradient.x * radialDirection.y,
    sign * length - GUMMY_ROOK_EDGE_RADIUS,
  )
}

const rookBoxContact = (point: d.v3f, center: d.v3f, half: d.v3f) => {
  'use gpu'
  const local = std.sub(point, center)
  const q = std.add(
    std.sub(std.abs(local), half),
    d.vec3f(GUMMY_ROOK_MERLON_RADIUS),
  )
  const positive = std.max(q, d.vec3f(0))
  const length = std.length(positive)
  let normal = d.vec3f(0)
  if (length > 0.000001) normal = std.div(positive, length)
  else if (q.x >= q.y && q.x >= q.z) normal.x = 1
  else if (q.y >= q.z) normal.y = 1
  else normal.z = 1
  const signs = d.vec3f(
    std.select(-1, 1, local.x >= 0),
    std.select(-1, 1, local.y >= 0),
    std.select(-1, 1, local.z >= 0),
  )
  return d.vec4f(
    std.mul(normal, signs),
    length +
      std.min(std.max(q.x, std.max(q.y, q.z)), 0) -
      GUMMY_ROOK_MERLON_RADIUS,
  )
}

export const gummyRookContact = (point: d.v3f) => {
  'use gpu'
  let field = rookLatheContact(point)
  for (const i of tgpu.unroll(std.range(GUMMY_ROOK_MERLONS.length))) {
    const other = rookBoxContact(point, merlonCenter(i), merlonHalf(i))
    const h = std.clamp(
      0.5 + (0.5 * (other.w - field.w)) / GUMMY_ROOK_BLEND,
      0,
      1,
    )
    field = d.vec4f(
      std.mix(other.xyz, field.xyz, h),
      std.mix(other.w, field.w, h) - GUMMY_ROOK_BLEND * h * (1 - h),
    )
  }
  const length = std.length(field.xyz)
  let normal = d.vec3f(0, -1, 0)
  if (length > 0.000001) normal = std.div(field.xyz, length)
  return d.vec4f(normal, field.w)
}

/** Coulomb-limited impulse in the collider frame; separating or untouched material is unchanged. */
export const gummyRookContactVelocity = (
  velocity: d.v3f,
  colliderVelocity: d.v3f,
  normal: d.v3f,
  gap: number,
  friction: number,
) => {
  'use gpu'
  if (gap > 0) return d.vec3f(velocity)
  const relative = std.sub(velocity, colliderVelocity)
  const inward = std.dot(relative, normal)
  if (inward >= 0) return d.vec3f(velocity)
  const tangent = std.sub(relative, std.mul(normal, inward))
  const speed = std.length(tangent)
  const retained = std.max(
    0,
    1 + (std.clamp(friction, 0, 1) * inward) / std.max(speed, 0.000001),
  )
  return std.add(colliderVelocity, std.mul(tangent, retained))
}

/** Normal correction capped at a fraction of particle spacing, not an unbounded position teleport. */
export const gummyRookContactCorrection = (
  contact: d.v4f,
  radius: number,
  maximum: number,
) => {
  'use gpu'
  return std.mul(contact.xyz, std.clamp(radius - contact.w, 0, maximum))
}

/** Production defaults retain the exact legacy rook; selected moulds can supply sampled contact. */
export const gummyColliderContactSlot = tgpu.slot(gummyRookContact)
export const gummyColliderMayContactSlot = tgpu.slot(gummyRookMayContact)
