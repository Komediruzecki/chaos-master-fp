/**
 * A closed, hollow lathed glass envelope around either native pawn family.
 * The intact surface and finite closed wedge shards share one authored grid;
 * fracture adds inner and cut faces rather than replacing glass with particles.
 * All meshes use triangle-list vertices packed as position.xyz / normal.xyz.
 */
import { createSeededRandomSource } from '../randomSource'
import type { Vec3 } from '../clash/placement'

export type PawnMesh = { vertices: Float32Array }
export type PawnShellFragment = PawnMesh & {
  centroid: Vec3
  velocity: Vec3
  angularVelocity: Vec3
}
export type PawnShellOptions = {
  radialSegments?: number
  /** Smooth intact and shard surfaces while retaining sharp profile creases. */
  smoothNormals?: boolean
}

export const PAWN_BOARD_TILE_SIZE = 1.6
/** Raise the complete pawn by -PAWN_SHELL_FLOOR to rest its shell on a tile. */
export const PAWN_SHELL_FLOOR = -0.03
export const PAWN_SHELL_TOP = 1.86
export const PAWN_SHELL_RADIUS = 0.67

type ProfilePoint = readonly [radius: number, y: number]
// The broad foot encloses the structural Menger square as well as the original
// round scaffold. Shaft, flange, and spherical crown stay recognizable at play distance.
const PROFILE: readonly ProfilePoint[] = [
  [0, PAWN_SHELL_FLOOR],
  [0.67, PAWN_SHELL_FLOOR],
  [0.67, 0],
  [0.67, 0.075],
  [0.67, 0.115],
  [0.665, 0.2],
  [0.665, 0.24],
  [0.47, 0.28],
  [0.38, 0.32],
  [0.29, 0.4],
  [0.23, 0.62],
  [0.2, 0.84],
  [0.255, 0.99],
  [0.275, 1.04],
  [0.275, 1.08],
  [0.275, 1.12],
  [0.275, 1.17],
  [0.28, 1.2],
  [0.335, 1.27],
  [0.372, 1.36],
  [0.39, 1.47],
  [0.372, 1.58],
  [0.326, 1.68],
  [0.249, 1.77],
  [0.151, 1.83],
  [0, PAWN_SHELL_TOP],
]
const INNER_PROFILE = PROFILE.map(
  ([radius, y], index): ProfilePoint => [
    Math.max(0, radius - 0.018),
    index <= 1
      ? -0.006
      : index === PROFILE.length - 1
        ? 1.835
        : y > 1.8
          ? y - 0.018
          : y,
  ],
)

function segments(options: PawnShellOptions) {
  const count = options.radialSegments ?? 32
  if (!Number.isInteger(count) || count < 24 || count > 64)
    throw new RangeError('radialSegments must be an integer between 24 and 64')
  return count
}

function point([radius, y]: ProfilePoint, angle: number): Vec3 {
  return [radius * Math.cos(angle), y, radius * Math.sin(angle)]
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function average(points: readonly Vec3[]): Vec3 {
  const at = (axis: number) =>
    points.reduce((sum, p) => sum + p[axis]!, 0) / points.length
  return [at(0), at(1), at(2)]
}

function emitFace(
  vertices: number[],
  face: readonly Vec3[],
  centre: Vec3,
  normals?: readonly Vec3[],
) {
  for (let index = 1; index < face.length - 1; index++) {
    const a = face[0]!
    let b = face[index]!
    let c = face[index + 1]!
    let bIndex = index
    let cIndex = index + 1
    const ab = subtract(b, a)
    const ac = subtract(c, a)
    let normal: Vec3 = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]
    const length = Math.hypot(...normal)
    if (length < 1e-12) continue
    const outward = subtract(average([a, b, c]), centre)
    if (
      normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] <
      0
    ) {
      ;[b, c] = [c, b]
      ;[bIndex, cIndex] = [cIndex, bIndex]
      normal = [-normal[0], -normal[1], -normal[2]]
    }
    const unit: Vec3 = [
      normal[0] / length,
      normal[1] / length,
      normal[2] / length,
    ]
    for (const [position, vertexIndex] of [
      [a, 0],
      [b, bIndex],
      [c, cIndex],
    ] as const)
      vertices.push(...position, ...(normals?.[vertexIndex] ?? unit))
  }
}

const CREASE_COSINE = Math.cos((40 * Math.PI) / 180)

/** Meridional outward normals; radial interpolation closes the lathe seam. */
function surfaceNormals(
  profile: readonly ProfilePoint[],
  band: number,
  angleA: number,
  angleB: number,
  inward: boolean,
): Vec3[] {
  const segmentNormal = (index: number): ProfilePoint => {
    const from = profile[index]!
    const to = profile[index + 1]!
    const radial = to[1] - from[1]
    const vertical = from[0] - to[0]
    const length = Math.hypot(radial, vertical)
    return [radial / length, vertical / length]
  }
  const current = segmentNormal(band)
  const at = (index: number, angle: number): Vec3 => {
    const sign = inward ? -1 : 1
    let normal = current
    if (profile[index]![0] === 0) {
      // Every incident crown triangle meets one axial normal at its pole.
      return [0, sign * Math.sign(current[1]), 0]
    }
    const neighbour = index === band ? band - 1 : band + 1
    if (neighbour >= 0 && neighbour < profile.length - 1) {
      const other = segmentNormal(neighbour)
      if (current[0] * other[0] + current[1] * other[1] >= CREASE_COSINE) {
        const radial = current[0] + other[0]
        const vertical = current[1] + other[1]
        const length = Math.hypot(radial, vertical)
        normal = [radial / length, vertical / length]
      }
    }
    return [
      sign * normal[0] * Math.cos(angle),
      sign * normal[1],
      sign * normal[0] * Math.sin(angle),
    ]
  }
  return [
    at(band, angleA),
    at(band + 1, angleA),
    at(band + 1, angleB),
    at(band, angleB),
  ]
}

function cells(
  options: PawnShellOptions,
  visit: (
    corners: readonly Vec3[],
    centre: Vec3,
    normals?: readonly Vec3[],
  ) => void,
) {
  const count = segments(options)
  for (let band = 0; band < PROFILE.length - 1; band++) {
    for (let radial = 0; radial < count; radial++) {
      const a = (radial / count) * 2 * Math.PI
      const b = ((radial + 1) / count) * 2 * Math.PI
      const corners = [
        point(PROFILE[band]!, a),
        point(PROFILE[band + 1]!, a),
        point(PROFILE[band + 1]!, b),
        point(PROFILE[band]!, b),
        point(INNER_PROFILE[band]!, a),
        point(INNER_PROFILE[band + 1]!, a),
        point(INNER_PROFILE[band + 1]!, b),
        point(INNER_PROFILE[band]!, b),
      ]
      const normals = options.smoothNormals
        ? [
            ...surfaceNormals(PROFILE, band, a, b, false),
            ...surfaceNormals(INNER_PROFILE, band, a, b, true),
          ]
        : undefined
      visit(corners, average(corners), normals)
    }
  }
}

const SURFACES = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
] as const
const CUT_FACES = [
  [0, 3, 7, 4],
  [1, 5, 6, 2],
  [0, 4, 5, 1],
  [3, 2, 6, 7],
] as const

export function buildPawnShellGeometry(
  options: PawnShellOptions = {},
): PawnMesh {
  const vertices: number[] = []
  cells(options, (corners, centre, normals) => {
    for (const indices of SURFACES)
      emitFace(
        vertices,
        indices.map((index) => corners[index]!),
        centre,
        normals && indices.map((index) => normals[index]!),
      )
  })
  return { vertices: new Float32Array(vertices) }
}

/** Tests the faceted inner surface, including its real floor and crown cap. */
export function isPointInsidePawnShellCavity(
  position: Vec3,
  options: PawnShellOptions = {},
): boolean {
  const count = segments(options)
  if (!position.every(Number.isFinite)) return false
  const y = position[1]
  for (let band = 0; band < INNER_PROFILE.length - 1; band++) {
    const lower = INNER_PROFILE[band]!
    const upper = INNER_PROFILE[band + 1]!
    if (upper[1] <= lower[1] || y < lower[1] || y > upper[1]) continue
    const t = (y - lower[1]) / (upper[1] - lower[1])
    const radius = lower[0] + (upper[0] - lower[0]) * t
    const step = (2 * Math.PI) / count
    const angle = Math.atan2(position[2], position[0])
    const local = ((angle % step) + step) % step
    const projected =
      Math.hypot(position[0], position[2]) * Math.cos(local - step / 2)
    return projected <= radius * Math.cos(step / 2) + 1e-7
  }
  return false
}

/** Velocities are metres/second; angular velocities are radians/second. */
export function buildPawnShellFragments(
  options: PawnShellOptions & { seed?: number } = {},
): PawnShellFragment[] {
  const seed = options.seed ?? 0x676c6173
  if (!Number.isInteger(seed) || seed < -0x8000_0000 || seed > 0xffff_ffff)
    throw new RangeError('seed must be a finite 32-bit integer')
  const random = createSeededRandomSource(seed)
  const fragments: PawnShellFragment[] = []
  cells(options, (corners, centroid, normals) => {
    const vertices: number[] = []
    const local = corners.map((corner) => subtract(corner, centroid))
    for (const indices of SURFACES)
      emitFace(
        vertices,
        indices.map((index) => local[index]!),
        [0, 0, 0],
        normals && indices.map((index) => normals[index]!),
      )
    for (const indices of CUT_FACES)
      emitFace(
        vertices,
        indices.map((index) => local[index]!),
        [0, 0, 0],
      )
    const radial = Math.hypot(centroid[0], centroid[2]) || 1
    const speed = 0.75 + random() * 1.6
    fragments.push({
      vertices: new Float32Array(vertices),
      centroid,
      velocity: [
        (centroid[0] / radial) * speed + (random() - 0.5) * 0.45,
        0.7 + random() * 2,
        (centroid[2] / radial) * speed + (random() - 0.5) * 0.45,
      ],
      angularVelocity: [
        (random() - 0.5) * 12,
        (random() - 0.5) * 12,
        (random() - 0.5) * 12,
      ],
    })
  })
  return fragments
}
