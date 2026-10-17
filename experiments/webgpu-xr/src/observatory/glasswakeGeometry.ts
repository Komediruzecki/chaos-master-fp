// Three coherent crystal petals split into closed prism shards with deterministic bounded motion.
export type GlassPoint = readonly [number, number, number]
export const GLASSWAKE_SHARD_COUNT = 48
export const GLASSWAKE_VERTICES_PER_SHARD = 24
export const GLASSWAKE_VERTEX_FLOATS = 12
export const GLASSWAKE_INSTANCE_FLOATS = 24
export const GLASSWAKE_BURST_SECONDS = 1.4
const sealTints: readonly GlassPoint[] = [
  [0.62, 0.86, 1],
  [1, 0.83, 0.55],
  [0.62, 1, 0.85],
]

export interface GlasswakeFrame {
  center: GlassPoint
  time: number
  charge: number
  accepted: number
  holding: boolean
  burstTimes: readonly number[]
  motion: boolean
  clay?: boolean
}

export interface CrystalShard {
  group: number
  center: GlassPoint
  velocity: GlassPoint
  spin: GlassPoint
}

export interface GlasswakeGeometry {
  vertices: Float32Array<ArrayBuffer>
  shards: CrystalShard[]
  triangles: number
  bytes: number
  bounds: { min: number[]; max: number[] }
}

const subtract = (a: GlassPoint, b: GlassPoint): GlassPoint => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const cross = (a: GlassPoint, b: GlassPoint): GlassPoint => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: GlassPoint, b: GlassPoint) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const seed = (index: number) =>
  ((Math.imul(index + 19, 1664525) + 1013904223) >>> 0) / 4294967296
const clamp01 = (value: number) =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))

/** Front/back/cut faces all share the same storage vertex layout; normal.w identifies a cut face. */
export function createGlasswakeGeometry(): GlasswakeGeometry {
  const packed: number[] = []
  const shards: CrystalShard[] = []
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const cuts = [0, 0.09, 0.21, 0.34, 0.5, 0.64, 0.78, 0.9, 1]
  const thickness = 0.055

  function prism(front: GlassPoint[], group: number) {
    const points = [
      ...front,
      ...front.map(
        (point): GlassPoint => [point[0], point[1], point[2] - thickness],
      ),
    ]
    const center: GlassPoint = [
      (front[0][0] + front[1][0] + front[2][0]) / 3,
      (front[0][1] + front[1][1] + front[2][1]) / 3,
      (front[0][2] + front[1][2] + front[2][2]) / 3 - thickness / 2,
    ]
    const index = shards.length
    const radial = Math.hypot(center[0], center[1])
    const scatter = seed(index * 131)
    // Send the release through depth, keeping its full tumble above the controls.
    const tangent = index % 2 ? 0.12 : -0.12
    const push = 0.12 * (0.7 + scatter * 0.2)
    shards.push({
      group,
      center,
      velocity: [
        (center[0] * push - center[1] * tangent) / radial,
        (center[1] * push + center[0] * tangent) / radial -
          (group === 0 ? 0.2 : 0),
        -(0.15 + seed(index * 73) * 0.35) * 0.7,
      ],
      spin: [
        (seed(index * 179) - 0.5) * 7,
        (seed(index * 331) - 0.5) * 8,
        (seed(index * 509) - 0.5) * 6,
      ],
    })
    const faces = [
      [0, 1, 2],
      [5, 4, 3],
      [0, 3, 4],
      [0, 4, 1],
      [1, 4, 5],
      [1, 5, 2],
      [2, 5, 3],
      [2, 3, 0],
    ]
    faces.forEach((face, faceIndex) => {
      const a = points[face[0]]
      let b = points[face[1]]
      let c = points[face[2]]
      let normal = cross(subtract(b, a), subtract(c, a))
      if (dot(normal, subtract(a, center)) < 0) {
        const previous = b
        b = c
        c = previous
        normal = cross(subtract(b, a), subtract(c, a))
      }
      const length = Math.hypot(...normal)
      const corners = [a, b, c]
      corners.forEach((point, corner) => {
        const local = subtract(point, center)
        packed.push(
          ...local,
          1,
          normal[0] / length,
          normal[1] / length,
          normal[2] / length,
          faceIndex < 2 ? 0 : 1,
          Number(corner === 0),
          Number(corner === 1),
          Number(corner === 2),
          0,
        )
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], point[axis])
          max[axis] = Math.max(max[axis], point[axis])
        }
      })
    })
  }

  for (let group = 0; group < 3; group++) {
    const point = (u: number, side: number): GlassPoint => {
      const angle = Math.PI / 2 + (group * Math.PI * 2) / 3 + (u - 0.5) * 1.54
      const width = 0.06 + 0.16 * Math.sin(Math.PI * u)
      const radius = 0.91 + side * width
      return [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        0.13 * Math.sin(Math.PI * u) -
          0.075 * side +
          0.04 * Math.cos(Math.PI * u * 2),
      ]
    }
    for (let cell = 0; cell < cuts.length - 1; cell++) {
      const a = point(cuts[cell], -1)
      const b = point(cuts[cell], 1)
      const c = point(cuts[cell + 1], 1)
      const e = point(cuts[cell + 1], -1)
      if (cell % 2) {
        prism([a, b, e], group)
        prism([b, c, e], group)
      } else {
        prism([a, b, c], group)
        prism([a, c, e], group)
      }
    }
  }
  const vertices = new Float32Array(packed)
  return {
    vertices,
    shards,
    triangles: vertices.length / GLASSWAKE_VERTEX_FLOATS / 3,
    bytes: vertices.byteLength,
    bounds: { min, max },
  }
}

/** Write one reusable matrix/material/effect record. No allocation or retained per-frame state. */
export function writeGlasswakeInstance(
  shard: CrystalShard,
  index: number,
  frame: GlasswakeFrame,
  target: Float32Array,
  offset: number,
): boolean {
  const accepted = Math.max(0, Math.min(3, Math.trunc(frame.accepted) || 0))
  const broken = shard.group < accepted
  const time = Number.isFinite(frame.time) ? frame.time : 0
  const timestamp = frame.burstTimes[shard.group]
  const age = broken
    ? frame.motion && Number.isFinite(timestamp)
      ? Math.max(0, time - timestamp)
      : GLASSWAKE_BURST_SECONDS
    : -1
  if (age >= GLASSWAKE_BURST_SECONDS) return false
  const charge = shard.group === accepted ? clamp01(frame.charge) : 0
  const fade = broken ? 1 - clamp01((age - 0.86) / 0.54) : 1
  const travel = broken ? 1 - Math.exp(-3.2 * age) : 0
  const vibration =
    !broken && frame.motion && frame.holding
      ? Math.sin(time * 24 + shard.group) * charge * 0.004
      : 0
  const angleX = broken ? age * shard.spin[0] : 0
  const angleY = broken ? age * shard.spin[1] : 0
  const angleZ = broken ? age * shard.spin[2] : 0
  const sx = Math.sin(angleX),
    cx = Math.cos(angleX)
  const sy = Math.sin(angleY),
    cy = Math.cos(angleY)
  const sz = Math.sin(angleZ),
    cz = Math.cos(angleZ)
  const size = broken ? 0.78 + fade * 0.22 : 1
  target[offset] = cz * cy * size
  target[offset + 1] = sz * cy * size
  target[offset + 2] = -sy * size
  target[offset + 3] = 0
  target[offset + 4] = (cz * sy * sx - sz * cx) * size
  target[offset + 5] = (sz * sy * sx + cz * cx) * size
  target[offset + 6] = cy * sx * size
  target[offset + 7] = 0
  target[offset + 8] = (cz * sy * cx + sz * sx) * size
  target[offset + 9] = (sz * sy * cx - cz * sx) * size
  target[offset + 10] = cy * cx * size
  target[offset + 11] = 0
  target[offset + 12] =
    frame.center[0] + shard.center[0] + shard.velocity[0] * travel + vibration
  target[offset + 13] =
    frame.center[1] +
    shard.center[1] +
    shard.velocity[1] * travel -
    (broken ? 0.06 * age * age : 0)
  target[offset + 14] =
    frame.center[2] + shard.center[2] + shard.velocity[2] * travel
  target[offset + 15] = 1
  const tint = sealTints[shard.group]
  target[offset + 16] = tint[0]
  target[offset + 17] = tint[1]
  target[offset + 18] = tint[2]
  target[offset + 19] = frame.clay ? 1 : 0
  target[offset + 20] = fade
  target[offset + 21] = charge
  target[offset + 22] = age
  target[offset + 23] = index
  return true
}
