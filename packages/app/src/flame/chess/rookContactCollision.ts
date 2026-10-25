/** Exact box-union narrow phase with a bounded spatial hash; touching cells are not penetration. */
import { worldPoint } from './rookContactBodies'
import { add, cross, dot, mul, rotate, sub } from './rookContactMath'
import { supportPoint } from './rookContactSupport'
import type { ContactBody } from './rookContactBodies'
import type { ContactVector as V, RookContactPhysics } from './rookContactTypes'

type Box = {
  center: V
  half: V
  axes: [V, V, V]
  min: V
  max: V
  body: number
  chunk: number
}
export type RookContact = {
  a: number
  b: number
  chunkA: number
  chunkB: number
  point: V
  normal: V
  depth: number
}
const BASIS: [V, V, V] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

function boxOf(
  center: V,
  half: V,
  axes: [V, V, V],
  body: number,
  chunk: number,
): Box {
  const extent = BASIS.map(
    (_, axis) =>
      Math.abs(axes[0][axis]!) * half[0] +
      Math.abs(axes[1][axis]!) * half[1] +
      Math.abs(axes[2][axis]!) * half[2],
  ) as V
  return {
    center,
    half,
    axes,
    min: sub(center, extent),
    max: add(center, extent),
    body,
    chunk,
  }
}

function worldBoxes(physics: RookContactPhysics, bodies: ContactBody[]) {
  const boxes: Box[] = []
  bodies.forEach((body, bodyIndex) => {
    const axes = BASIS.map((axis) => rotate(axis, body.rotation)) as [V, V, V]
    for (const chunkIndex of body.members) {
      const chunk = physics.chunks[chunkIndex]!,
        packed = chunk.boxes
      for (let offset = 0; offset < packed.length; offset += 6) {
        const local: V = [
          packed[offset]!,
          packed[offset + 1]!,
          packed[offset + 2]!,
        ]
        const half: V = [
          packed[offset + 3]!,
          packed[offset + 4]!,
          packed[offset + 5]!,
        ]
        boxes.push(
          boxOf(
            worldPoint(body, add(chunk.centroid, local)),
            half,
            axes,
            bodyIndex,
            chunkIndex,
          ),
        )
      }
    }
  })
  return boxes
}

function closest(box: Box, point: V): V {
  const delta = sub(point, box.center)
  let result: V = [...box.center]
  for (let axis = 0; axis < 3; axis++)
    result = add(
      result,
      mul(
        box.axes[axis]!,
        Math.max(
          -box.half[axis]!,
          Math.min(box.half[axis]!, dot(delta, box.axes[axis]!)),
        ),
      ),
    )
  return result
}

function intersection(a: Box, b: Box): RookContact | undefined {
  for (let axis = 0; axis < 3; axis++)
    if (
      a.max[axis]! <= b.min[axis]! + 1e-6 ||
      b.max[axis]! <= a.min[axis]! + 1e-6
    )
      return
  const delta = sub(a.center, b.center)
  let depth = Infinity,
    normal: V = [0, 1, 0]
  const axes = [...a.axes, ...b.axes]
  for (const u of a.axes) for (const v of b.axes) axes.push(cross(u, v))
  for (const candidate of axes) {
    const length = Math.hypot(...candidate)
    if (length < 1e-6) continue
    const n = mul(candidate, 1 / length)
    let radius = 0
    for (let axis = 0; axis < 3; axis++)
      radius +=
        a.half[axis]! * Math.abs(dot(a.axes[axis]!, n)) +
        b.half[axis]! * Math.abs(dot(b.axes[axis]!, n))
    const overlap = radius - Math.abs(dot(delta, n))
    if (overlap <= 1e-6) return
    if (overlap < depth) {
      depth = overlap
      normal = mul(n, dot(delta, n) < 0 ? -1 : 1)
    }
  }
  return {
    a: a.body,
    b: b.body,
    chunkA: a.chunk,
    chunkB: b.chunk,
    normal,
    depth,
    point: mul(add(closest(a, b.center), closest(b, a.center)), 0.5),
  }
}

function deepest(
  contacts: Map<string, RookContact>,
  contact: RookContact | undefined,
) {
  if (!contact) return
  let axis = 0
  for (let candidate = 1; candidate < 3; candidate++)
    if (Math.abs(contact.normal[candidate]!) > Math.abs(contact.normal[axis]!))
      axis = candidate
  // One contact per normal sector preserves opposing/edge constraints of a concave box union.
  const sector = axis * 2 + (contact.normal[axis]! > 0 ? 1 : 0)
  const key = `${contact.a}:${contact.b}:${sector}`
  if ((contacts.get(key)?.depth ?? -1) < contact.depth)
    contacts.set(key, contact)
}

function fragmentContacts(boxes: Box[], contacts: Map<string, RookContact>) {
  const buckets = new Map<number, number[]>(),
    tested = new Set<number>(),
    cell = 0.18
  boxes.forEach((box, index) => {
    const lo = box.min.map((value) => Math.floor(value / cell)),
      hi = box.max.map((value) => Math.floor(value / cell))
    for (let z = lo[2]!; z <= hi[2]!; z++)
      for (let y = lo[1]!; y <= hi[1]!; y++)
        for (let x = lo[0]!; x <= hi[0]!; x++) {
          // Hash collisions only add candidate pairs; the exact AABB/SAT test still decides contact.
          const key = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791),
            bucket = buckets.get(key) ?? []
          for (const otherIndex of bucket) {
            const other = boxes[otherIndex]!
            if (box.body === other.body) continue
            const pair = index * boxes.length + otherIndex
            if (tested.has(pair)) continue
            tested.add(pair)
            deepest(contacts, intersection(box, other))
          }
          bucket.push(index)
          buckets.set(key, bucket)
        }
  })
}

function floorContact(
  physics: RookContactPhysics,
  body: ContactBody,
  bodyIndex: number,
): RookContact | undefined {
  let min = Infinity,
    support: V[] = [],
    chunkA = body.members[0]!
  for (const member of body.members) {
    const chunk = physics.chunks[member]!,
      points = chunk.supportPoints
    for (let offset = 0; offset < points.length; offset += 3) {
      const p = worldPoint(
        body,
        add(chunk.centroid, [
          points[offset]!,
          points[offset + 1]!,
          points[offset + 2]!,
        ]),
      )
      if (p[1] < min - 1e-5) {
        min = p[1]
        support = [p]
        chunkA = member
      } else if (p[1] <= min + 1e-5) {
        support.push(p)
      }
    }
  }
  return min < 0.0001
    ? {
        a: bodyIndex,
        b: -1,
        chunkA,
        chunkB: -1,
        point: supportPoint(support, body.center, min),
        normal: [0, 1, 0],
        depth: Math.max(0, -min),
      }
    : undefined
}

export function findRookContacts(
  physics: RookContactPhysics,
  bodies: ContactBody[],
  attacker: { position: V; radius: number; height: number },
): RookContact[] {
  const boxes = worldBoxes(physics, bodies),
    contacts = new Map<string, RookContact>()
  const collider = boxOf(
    add(attacker.position, [0, attacker.height / 2, 0]),
    [attacker.radius, attacker.height / 2, attacker.radius],
    BASIS,
    -2,
    -1,
  )
  for (const box of boxes) deepest(contacts, intersection(box, collider))
  if (bodies.length > 1) fragmentContacts(boxes, contacts)
  bodies.forEach((body, index) => {
    deepest(contacts, floorContact(physics, body, index))
  })
  return [...contacts.values()].sort(
    (a, b) =>
      a.a - b.a ||
      a.b - b.b ||
      a.normal[0] - b.normal[0] ||
      a.normal[1] - b.normal[1] ||
      a.normal[2] - b.normal[2],
  )
}

/** Re-evaluate actual support after fragment/attacker corrections, which can otherwise push a body below the board. */
export function findRookFloorContacts(
  physics: RookContactPhysics,
  bodies: ContactBody[],
) {
  return bodies.flatMap((body, index) => {
    const contact = floorContact(physics, body, index)
    return contact ? [contact] : []
  })
}
