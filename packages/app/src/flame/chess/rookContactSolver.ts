/** Deterministic worker-baked rigid contact and bond failure, with no scheduled burst or live CPU simulation. */
import { connectedBodies, inverseInertia, pointVelocity, worldPoint, writeBodyPoses, } from './rookContactBodies'
import { findRookContacts, findRookFloorContacts } from './rookContactCollision'
import { add, cap, cross, dot, mul, sub, turn } from './rookContactMath'
import { ROOK_CONTACT_MAX_BOXES, ROOK_CONTACT_MAX_FRAMES, } from './rookContactTypes'
import type { ContactBody } from './rookContactBodies'
import type { RookContact } from './rookContactCollision'
import type { ContactVector as V, RookContactMotion, RookContactShot, } from './rookContactTypes'

function validate(input: RookContactShot) {
  const frameCount = Math.round(input.duration * input.sampleRate) + 1
  const boxCount = input.physics.chunks.reduce(
    (sum, chunk) => sum + chunk.boxes.length / 6,
    0,
  )
  if (
    !Number.isInteger(input.sampleRate) ||
    input.sampleRate < 60 ||
    input.sampleRate > 120 ||
    frameCount < 2 ||
    frameCount > ROOK_CONTACT_MAX_FRAMES
  )
    throw new RangeError(
      'Contact motion needs 60–120 samples per second and at most 361 frames.',
    )
  if (
    !input.physics.chunks.length ||
    input.physics.chunks.length > 32 ||
    boxCount > ROOK_CONTACT_MAX_BOXES
  )
    throw new RangeError(
      'Contact motion exceeds its piece or collision-box budget.',
    )
  if (
    input.attacker.path.length !== frameCount * 3 ||
    !input.attacker.path.every(Number.isFinite)
  )
    throw new RangeError(
      'The contact path must contain one finite xyz position per sample.',
    )
  if (
    ![input.attacker.radius, input.attacker.height, input.strength ?? 1].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new RangeError(
      'Contact dimensions and strength must be positive and finite.',
    )
  return { frameCount, boxCount }
}

function effectiveMass(body: ContactBody, lever: V, direction: V) {
  return (
    body.invMass +
    dot(direction, cross(inverseInertia(body, cross(lever, direction)), lever))
  )
}

function applyImpulse(body: ContactBody, impulse: V, lever: V) {
  body.velocity = add(body.velocity, mul(impulse, body.invMass))
  body.angular = add(body.angular, inverseInertia(body, cross(lever, impulse)))
}

export function resolveRookContact(
  contact: RookContact,
  bodies: ContactBody[],
  attackerVelocity: V,
) {
  const a = bodies[contact.a]!,
    b = bodies[contact.b]
  const leverA = sub(contact.point, a.center),
    leverB = b ? sub(contact.point, b.center) : ([0, 0, 0] as V)
  const otherVelocity = b
    ? pointVelocity(b, contact.point)
    : contact.b === -2
      ? attackerVelocity
      : ([0, 0, 0] as V)
  const relative = sub(pointVelocity(a, contact.point), otherVelocity)
  const closingSpeed = Math.max(0, -dot(relative, contact.normal))
  const denominator =
    effectiveMass(a, leverA, contact.normal) +
    (b ? effectiveMass(b, leverB, contact.normal) : 0)
  const normalImpulse =
    (closingSpeed * (closingSpeed > 0.7 ? 1.08 : 1)) / denominator
  const impulse = mul(contact.normal, normalImpulse)
  applyImpulse(a, impulse, leverA)
  if (b) applyImpulse(b, mul(impulse, -1), leverB)
  const afterNormal = sub(
    pointVelocity(a, contact.point),
    b ? pointVelocity(b, contact.point) : otherVelocity,
  )
  const tangent = sub(
      afterNormal,
      mul(contact.normal, dot(afterNormal, contact.normal)),
    ),
    speed = Math.hypot(...tangent)
  if (speed > 1e-6 && normalImpulse > 0) {
    const direction = mul(tangent, 1 / speed)
    const frictionMass =
      effectiveMass(a, leverA, direction) +
      (b ? effectiveMass(b, leverB, direction) : 0)
    const friction = mul(
      direction,
      -Math.min(speed / frictionMass, normalImpulse * 0.6),
    )
    applyImpulse(a, friction, leverA)
    if (b) applyImpulse(b, mul(friction, -1), leverB)
  }
  const totalInverseMass = a.invMass + (b?.invMass ?? 0)
  const correction = mul(
    contact.normal,
    (Math.max(0, contact.depth - 1e-5) * (contact.b === -1 ? 1 : 0.8)) /
      totalInverseMass,
  )
  a.center = add(a.center, mul(correction, a.invMass))
  if (b) b.center = sub(b.center, mul(correction, b.invMass))
  return { normalImpulse, closingSpeed }
}

function damageBonds(
  input: RookContactShot,
  bodies: ContactBody[],
  contact: RookContact,
  energy: number,
  damage: Float64Array,
  brokenAt: Float32Array,
  time: number,
) {
  let changed = false
  for (const [chunkIndex, bodyIndex] of [
    [contact.chunkA, contact.a],
    [contact.chunkB, contact.b],
  ]) {
    if (bodyIndex! < 0) continue
    const body = bodies[bodyIndex!]!
    input.physics.bonds.forEach((bond, index) => {
      if (
        brokenAt[index]! >= 0 ||
        (bond.a !== chunkIndex && bond.b !== chunkIndex)
      )
        return
      const distance = Math.hypot(
        ...sub(worldPoint(body, bond.centroid), contact.point),
      )
      const weight = 1 / (1 + distance / (input.physics.cellSize * 4))
      damage[index]! += energy * weight
      if (damage[index]! <= bond.area * (input.strength ?? 1)) return
      brokenAt[index] = time
      changed = true
    })
  }
  return changed
}

type ContactStep = {
  input: RookContactShot
  bodies: ContactBody[]
  damage: Float64Array
  brokenAt: Float32Array
  stats: RookContactMotion['stats']
  time: number
}

function processContacts(
  step: ContactStep,
  contacts: RookContact[],
  velocity: V,
) {
  let changed = false
  for (const contact of contacts) {
    step.stats.contacts++
    step.stats.maxPenetration = Math.max(
      step.stats.maxPenetration,
      contact.depth,
    )
    const { normalImpulse, closingSpeed } = resolveRookContact(
      contact,
      step.bodies,
      velocity,
    )
    if (contact.b === -2 && normalImpulse > 1e-6 && step.stats.firstContact < 0)
      step.stats.firstContact = step.time
    // Static floor support cannot fatigue the bonds. Only an actual impact's impulse and approach speed can.
    if (closingSpeed > 0.35 && normalImpulse > 1e-6)
      changed =
        damageBonds(
          step.input,
          step.bodies,
          contact,
          (normalImpulse * closingSpeed) / 2,
          step.damage,
          step.brokenAt,
          step.time,
        ) || changed
  }
  if (changed)
    step.bodies = connectedBodies(
      step.input.physics,
      step.brokenAt,
      step.bodies,
    )
  return changed
}

/** Collider radius is represented by a square prism; the victim uses its exact disjoint cell-box union. */
export function bakeRookContactShot(input: RookContactShot): RookContactMotion {
  const { frameCount, boxCount } = validate(input),
    { physics, attacker, sampleRate } = input
  const dt = 1 / sampleRate,
    chunkCount = physics.chunks.length
  const brokenAt = new Float32Array(physics.bonds.length).fill(-1),
    damage = new Float64Array(physics.bonds.length)
  const poses = new Float32Array(frameCount * chunkCount * 8)
  const stats = {
    boxCount,
    steps: frameCount - 1,
    contacts: 0,
    brokenBonds: 0,
    firstContact: -1,
    maxPenetration: 0,
  }
  let bodies = connectedBodies(physics, brokenAt)
  writeBodyPoses(poses, 0, physics, bodies)
  for (let frame = 1; frame < frameCount; frame++) {
    for (const body of bodies) {
      body.velocity = mul(
        add(body.velocity, [0, -9.81 * dt, 0]),
        Math.exp(-0.3 * dt),
      )
      body.angular = mul(body.angular, Math.exp(-0.7 * dt))
      body.center = add(body.center, mul(body.velocity, dt))
      body.rotation = turn(body.rotation, body.angular, dt)
    }
    const offset = frame * 3
    const position: V = [
      attacker.path[offset]!,
      attacker.path[offset + 1]!,
      attacker.path[offset + 2]!,
    ]
    const previous: V = [
      attacker.path[offset - 3]!,
      attacker.path[offset - 2]!,
      attacker.path[offset - 1]!,
    ]
    const velocity = mul(sub(position, previous), sampleRate)
    const contacts = findRookContacts(physics, bodies, {
      position,
      radius: attacker.radius,
      height: attacker.height,
    })
    const step: ContactStep = {
      input,
      bodies,
      damage,
      brokenAt,
      stats,
      time: frame * dt,
    }
    processContacts(step, contacts, velocity)
    // Newly independent interlocking chunks need another broad/narrow phase after projection.
    // At most four additional passes bound worker cost; resting contacts exit early.
    for (
      let iteration = 0;
      iteration < 4 && step.bodies.length > 1;
      iteration++
    ) {
      const corrections = findRookContacts(physics, step.bodies, {
        position,
        radius: attacker.radius,
        height: attacker.height,
      })
      const fractured = processContacts(step, corrections, velocity)
      if (
        !fractured &&
        corrections.every(
          (contact) =>
            contact.b === -1 || contact.depth < physics.cellSize * 0.25,
        )
      )
        break
    }
    bodies = step.bodies
    for (const contact of findRookFloorContacts(physics, bodies))
      resolveRookContact(contact, bodies, [0, 0, 0])
    for (const body of bodies) {
      body.velocity = cap(body.velocity, 12)
      body.angular = cap(body.angular, 14)
    }
    writeBodyPoses(poses, frame, physics, bodies)
  }
  stats.brokenBonds = brokenAt.filter((time) => time >= 0).length
  return { poses, sampleRate, frameCount, chunkCount, brokenAt, stats }
}
