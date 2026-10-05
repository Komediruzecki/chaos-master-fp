/** Geometric, unilateral two-body impulses; independent grid transfers keep separated bodies uncoupled. */
import { d, std } from 'typegpu'

/** Normal points from A to B; the gap includes swept particle motion during this microstep. */
export const gummyPairSweptContact = (
  delta: d.v3f,
  relativeVelocity: d.v3f,
  diameter: number,
  dt: number,
) => {
  'use gpu'
  const speedSquared = std.dot(relativeVelocity, relativeVelocity)
  const closestTime = std.clamp(
    -std.dot(delta, relativeVelocity) / std.max(speedSquared, 0.00000001),
    0,
    dt,
  )
  const closest = std.add(delta, std.mul(relativeVelocity, closestTime))
  const distance = std.length(delta)
  let normal = d.vec3f(0, 1, 0)
  if (distance > 0.000001) normal = std.div(delta, distance)
  else if (speedSquared > 0.00000001)
    normal = std.div(std.mul(relativeVelocity, -1), std.sqrt(speedSquared))
  return d.vec4f(normal, std.length(closest) - diameter)
}

/** Impulse on B; A receives its exact negative. Zero outside contact and on separation. */
export const gummyPairContactImpulse = (
  velocityA: d.v3f,
  velocityB: d.v3f,
  inverseMassA: number,
  inverseMassB: number,
  normal: d.v3f,
  gap: number,
  friction: number,
) => {
  'use gpu'
  const inverseMass = inverseMassA + inverseMassB
  if (gap > 0 || inverseMass <= 0) return d.vec3f(0)
  const relative = std.sub(velocityB, velocityA)
  const approaching = std.dot(relative, normal)
  if (approaching >= 0) return d.vec3f(0)
  const normalImpulse = -approaching / inverseMass
  const tangent = std.sub(relative, std.mul(normal, approaching))
  const tangentSpeed = std.length(tangent)
  const tangentImpulse = std.min(
    tangentSpeed / inverseMass,
    std.clamp(friction, 0, 1) * normalImpulse,
  )
  return std.sub(
    std.mul(normal, normalImpulse),
    std.mul(tangent, tangentImpulse / std.max(tangentSpeed, 0.000001)),
  )
}
