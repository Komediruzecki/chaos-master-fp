/** Bond-connected pieces move as rigid compounds; splitting preserves position and point velocity. */
import { add, cross, mul, rotate, sub } from './rookContactMath'
import type { ContactQuaternion, ContactVector, RookContactPhysics, } from './rookContactTypes'

export type ContactBody = {
  members: number[]
  restCenter: ContactVector
  center: ContactVector
  rotation: ContactQuaternion
  velocity: ContactVector
  angular: ContactVector
  invMass: number
  invInertia: ContactVector
}

function bodyOf(
  members: number[],
  physics: RookContactPhysics,
  parent?: ContactBody,
): ContactBody {
  let mass = 0
  let restCenter: ContactVector = [0, 0, 0]
  const min: ContactVector = [Infinity, Infinity, Infinity],
    max: ContactVector = [-Infinity, -Infinity, -Infinity]
  for (const member of members) {
    const chunk = physics.chunks[member]!
    mass += chunk.mass
    restCenter = add(restCenter, mul(chunk.centroid, chunk.mass))
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(
        min[axis]!,
        chunk.centroid[axis]! + chunk.localMin[axis]!,
      )
      max[axis] = Math.max(
        max[axis]!,
        chunk.centroid[axis]! + chunk.localMax[axis]!,
      )
    }
  }
  restCenter = mul(restCenter, 1 / mass)
  const extent = sub(max, min)
  // A diagonal box inertia is a bounded approximation; collision geometry remains the exact cell union.
  const inertia: ContactVector = [
    (mass * (extent[1] ** 2 + extent[2] ** 2)) / 12,
    (mass * (extent[0] ** 2 + extent[2] ** 2)) / 12,
    (mass * (extent[0] ** 2 + extent[1] ** 2)) / 12,
  ]
  const offset = parent
    ? rotate(sub(restCenter, parent.restCenter), parent.rotation)
    : ([0, 0, 0] as ContactVector)
  return {
    members,
    restCenter,
    center: parent ? add(parent.center, offset) : [...restCenter],
    rotation: parent ? [...parent.rotation] : [0, 0, 0, 1],
    velocity: parent
      ? add(parent.velocity, cross(parent.angular, offset))
      : [0, 0, 0],
    angular: parent ? [...parent.angular] : [0, 0, 0],
    invMass: 1 / mass,
    invInertia: inertia.map(
      (value) => 1 / Math.max(value, 1e-7),
    ) as ContactVector,
  }
}

export function connectedBodies(
  physics: RookContactPhysics,
  brokenAt: Float32Array,
  previous: ContactBody[] = [],
): ContactBody[] {
  const links = physics.chunks.map(() => [] as number[])
  physics.bonds.forEach((bond, index) => {
    if (brokenAt[index]! >= 0) return
    links[bond.a]!.push(bond.b)
    links[bond.b]!.push(bond.a)
  })
  const seen = new Set<number>(),
    bodies: ContactBody[] = []
  for (let start = 0; start < links.length; start++) {
    if (seen.has(start)) continue
    const members = [start]
    seen.add(start)
    for (let index = 0; index < members.length; index++)
      for (const other of links[members[index]!]!)
        if (!seen.has(other)) {
          seen.add(other)
          members.push(other)
        }
    const parent = previous.find((body) => body.members.includes(start))
    bodies.push(
      parent?.members.length === members.length
        ? parent
        : bodyOf(members, physics, parent),
    )
  }
  return bodies
}

export const worldPoint = (body: ContactBody, assembled: ContactVector) =>
  add(body.center, rotate(sub(assembled, body.restCenter), body.rotation))
export const pointVelocity = (body: ContactBody, point: ContactVector) =>
  add(body.velocity, cross(body.angular, sub(point, body.center)))
export function inverseInertia(
  body: ContactBody,
  vector: ContactVector,
): ContactVector {
  const q = body.rotation,
    local = rotate(vector, [-q[0], -q[1], -q[2], q[3]])
  return rotate(
    [
      local[0] * body.invInertia[0],
      local[1] * body.invInertia[1],
      local[2] * body.invInertia[2],
    ],
    q,
  )
}

export function writeBodyPoses(
  poses: Float32Array,
  frame: number,
  physics: RookContactPhysics,
  bodies: ContactBody[],
) {
  for (const body of bodies)
    for (const chunkIndex of body.members) {
      const centroid = physics.chunks[chunkIndex]!.centroid
      const translation = sub(worldPoint(body, centroid), centroid)
      const offset = (frame * physics.chunks.length + chunkIndex) * 8
      poses.set(translation, offset)
      poses.set(body.rotation, offset + 4)
    }
}
