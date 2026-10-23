/** XPBD tetrahedral projections, cohesive damage laws, and finite-press contact. */
import { d, std } from 'typegpu'

const TetProjection = d.struct({
  p0: d.vec4f,
  p1: d.vec4f,
  p2: d.vec4f,
  p3: d.vec4f,
  a: d.vec4f,
  b: d.vec4f,
})

/** Rotation-invariant XPBD distance constraint; xyz is the mass-unscaled correction. */
export const gummyEdgeProjection = (
  a: d.v4f,
  b: d.v4f,
  rest: number,
  lambda: number,
  alpha: number,
) => {
  'use gpu'
  const delta = std.sub(a.xyz, b.xyz)
  const length = std.length(delta)
  const denominator = a.w + b.w + alpha
  if (length < 0.0000001 || denominator < 0.0000001)
    return d.vec4f(0, 0, 0, lambda)
  const increment = (rest - length - alpha * lambda) / denominator
  return d.vec4f(std.mul(delta, increment / length), lambda + increment)
}

export const gummySignedVolume = (a: d.v3f, b: d.v3f, c: d.v3f, e: d.v3f) => {
  'use gpu'
  return std.dot(std.sub(b, a), std.cross(std.sub(c, a), std.sub(e, a))) / 6
}

/** Six elastic edge strains and signed volume; this is not a Neo-Hookean FEM energy. */
export const solveGummyTet = (
  p0: d.v4f,
  p1: d.v4f,
  p2: d.v4f,
  p3: d.v4f,
  restA: d.v4f,
  restB: d.v4f,
  lambdaA: d.v4f,
  lambdaB: d.v4f,
  stretchAlpha: number,
  volumeAlpha: number,
) => {
  'use gpu'
  const p = d.arrayOf(
    d.vec4f,
    4,
  )([d.vec4f(p0), d.vec4f(p1), d.vec4f(p2), d.vec4f(p3)])
  const lengths = d.arrayOf(
    d.f32,
    6,
  )([restA.x, restA.y, restA.z, restA.w, restB.x, restB.y])
  const lambda = d.arrayOf(
    d.f32,
    7,
  )([
    lambdaA.x,
    lambdaA.y,
    lambdaA.z,
    lambdaA.w,
    lambdaB.x,
    lambdaB.y,
    lambdaB.z,
  ])
  const edgePairs = d.arrayOf(
    d.vec2u,
    6,
  )([
    d.vec2u(0, 1),
    d.vec2u(0, 2),
    d.vec2u(0, 3),
    d.vec2u(1, 2),
    d.vec2u(1, 3),
    d.vec2u(2, 3),
  ])
  for (const edge of std.range(6)) {
    const pair = edgePairs[edge]!
    const q = gummyEdgeProjection(
      p[pair.x]!,
      p[pair.y]!,
      lengths[edge]!,
      lambda[edge]!,
      stretchAlpha,
    )
    p[pair.x] = d.vec4f(
      std.add(p[pair.x]!.xyz, std.mul(q.xyz, p[pair.x]!.w)),
      p[pair.x]!.w,
    )
    p[pair.y] = d.vec4f(
      std.sub(p[pair.y]!.xyz, std.mul(q.xyz, p[pair.y]!.w)),
      p[pair.y]!.w,
    )
    lambda[edge] = q.w
  }
  // C=V/Vrest-1 retains its sign through inversion. Gradients sum to zero.
  const e1 = std.sub(p[1]!.xyz, p[0]!.xyz)
  const e2 = std.sub(p[2]!.xyz, p[0]!.xyz)
  const e3 = std.sub(p[3]!.xyz, p[0]!.xyz)
  const scale = 1 / (6 * restB.z)
  const g1 = std.mul(std.cross(e2, e3), scale)
  const g2 = std.mul(std.cross(e3, e1), scale)
  const g3 = std.mul(std.cross(e1, e2), scale)
  const g0 = std.mul(std.add(std.add(g1, g2), g3), -1)
  const denominator =
    p[0]!.w * std.dot(g0, g0) +
    p[1]!.w * std.dot(g1, g1) +
    p[2]!.w * std.dot(g2, g2) +
    p[3]!.w * std.dot(g3, g3) +
    volumeAlpha
  if (denominator > 0.0000001) {
    const c = std.dot(e1, std.cross(e2, e3)) * scale - 1
    const increment = (-c - volumeAlpha * lambda[6]!) / denominator
    p[0] = d.vec4f(
      std.add(p[0]!.xyz, std.mul(g0, increment * p[0]!.w)),
      p[0]!.w,
    )
    p[1] = d.vec4f(
      std.add(p[1]!.xyz, std.mul(g1, increment * p[1]!.w)),
      p[1]!.w,
    )
    p[2] = d.vec4f(
      std.add(p[2]!.xyz, std.mul(g2, increment * p[2]!.w)),
      p[2]!.w,
    )
    p[3] = d.vec4f(
      std.add(p[3]!.xyz, std.mul(g3, increment * p[3]!.w)),
      p[3]!.w,
    )
    lambda[6] = lambda[6]! + increment
  }
  return TetProjection({
    p0: p[0]!,
    p1: p[1]!,
    p2: p[2]!,
    p3: p[3]!,
    a: d.vec4f(lambda[0]!, lambda[1]!, lambda[2]!, lambda[3]!),
    b: d.vec4f(lambda[4]!, lambda[5]!, lambda[6]!, 0),
  })
}

/** Rate-dependent opening damage for this study; irreversible and not material-calibrated. */
export const gummyOpeningDamage = (
  previous: number,
  opening: number,
  dt: number,
  enabled: number,
  onset: number,
  failure: number,
  rate: number,
) => {
  'use gpu'
  if (previous >= 1 || enabled < 0.5) return previous
  if (opening >= failure) return d.f32(1)
  const drive = std.max(0, opening / onset - 1)
  return std.min(1, previous + dt * rate * drive)
}

/** Study-unit cohesive traction: normalized masses and redundant face bonds are not SI forces. */
export const GUMMY_COHESIVE_YIELD = 1400
export const gummyScaledTractionDamage = (
  previous: number,
  opening: number,
  force: number,
  dt: number,
  enabled: number,
  onset: number,
  failure: number,
  rate: number,
  strengthScale: number,
) => {
  'use gpu'
  const opened = gummyOpeningDamage(
    previous,
    opening,
    dt,
    enabled,
    onset,
    failure,
    rate,
  )
  if (opened >= 1 || enabled < 0.5) return opened
  // A closed XPBD seam carries load in its multiplier; weakening lowers its remaining strength.
  const strength =
    GUMMY_COHESIVE_YIELD * strengthScale * std.max(0.15, 1 - previous)
  const drive = std.max(0, force / strength - 1)
  return std.min(1, opened + dt * 1.2 * drive)
}

/** Compatibility entry point retains the arm-pull study calibration. */
export const gummyTractionDamage = (
  previous: number,
  opening: number,
  force: number,
  dt: number,
  enabled: number,
  onset: number,
  failure: number,
  rate: number,
) => {
  'use gpu'
  return gummyScaledTractionDamage(
    previous,
    opening,
    force,
    dt,
    enabled,
    onset,
    failure,
    rate,
    1,
  )
}

/** Compression is excluded while tangential sliding still contributes to the fine-study law. */
export const gummyTensionShear = (value: d.v3f, normal: d.v3f) => {
  'use gpu'
  const signed = std.dot(value, normal)
  const tangent = std.sub(value, std.mul(normal, signed))
  const tension = std.max(0, signed)
  return std.sqrt(tension * tension + std.dot(tangent, tangent))
}

/** Point-node plane contact beneath a finite square press; the old floor is unchanged. */
export const gummyPressContact = (position: d.v3f, press: d.v4f) => {
  'use gpu'
  const p = d.vec3f(position)
  if (press.z > 0.5 && std.abs(p.x) <= press.y && std.abs(p.z) <= press.y)
    p.y = std.min(p.y, press.x)
  p.y = std.max(p.y, 0.006)
  return d.vec3f(p)
}
