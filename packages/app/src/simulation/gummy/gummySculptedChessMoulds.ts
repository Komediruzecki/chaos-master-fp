/** Compact candy moulds with turned rings, clear crowns and a sculpted horse, alongside the preserved classic set. */
import { roundedBox, roundedLathe, smoothUnion, sphere, } from './gummyChessFields'
import type { Point3, ProfilePoint } from './gummyChessFields'
import type { GummyChessMould } from './gummyChessMoulds'

// Two low beads frame an inset waist; broad changes survive particle reconstruction.
const FOOT: readonly ProfilePoint[] = [
  [0, 0.04],
  [0.56, 0.04],
  [0.64, 0.1],
  [0.65, 0.17],
  [0.61, 0.23],
  [0.52, 0.27],
  [0.51, 0.31],
  [0.57, 0.35],
  [0.59, 0.41],
  [0.55, 0.47],
  [0.43, 0.52],
]
const PAWN: readonly ProfilePoint[] = [
  ...FOOT,
  [0.35, 0.66],
  [0.27, 0.94],
  [0.21, 1.23],
  [0.24, 1.4],
  [0.37, 1.48],
  [0.38, 1.55],
  [0.27, 1.62],
  [0.22, 1.77],
  [0, 1.77],
]
const ROOK: readonly ProfilePoint[] = [
  ...FOOT,
  [0.35, 0.7],
  [0.28, 1.05],
  [0.27, 1.36],
  [0.32, 1.54],
  [0.47, 1.63],
  [0.49, 1.7],
  [0.44, 1.76],
  [0.52, 1.84],
  [0.55, 2.05],
  [0, 2.05],
]
const BISHOP: readonly ProfilePoint[] = [
  ...FOOT,
  [0.35, 0.68],
  [0.26, 1.05],
  [0.21, 1.42],
  [0.25, 1.55],
  [0.39, 1.64],
  [0.4, 1.72],
  [0.23, 1.8],
  [0.31, 1.95],
  [0.35, 2.14],
  [0.29, 2.35],
  [0.16, 2.53],
  [0.055, 2.65],
  [0, 2.69],
]
const QUEEN: readonly ProfilePoint[] = [
  ...FOOT,
  [0.35, 0.7],
  [0.27, 1.08],
  [0.215, 1.49],
  [0.24, 1.66],
  [0.39, 1.76],
  [0.405, 1.84],
  [0.27, 1.92],
  [0.28, 2.04],
  [0.39, 2.2],
  [0.47, 2.38],
  [0, 2.38],
]
const KING: readonly ProfilePoint[] = [
  ...FOOT,
  [0.36, 0.73],
  [0.285, 1.12],
  [0.245, 1.58],
  [0.29, 1.76],
  [0.41, 1.86],
  [0.415, 1.95],
  [0.275, 2.04],
  [0.275, 2.22],
  [0.36, 2.31],
  [0.34, 2.41],
  [0.2, 2.5],
  [0, 2.5],
]
const KNIGHT_FOOT: readonly ProfilePoint[] = [
  ...FOOT,
  [0.4, 0.58],
  [0.33, 0.66],
  [0, 0.66],
]
const HORSE: readonly (readonly [number, number])[] = [
  [-0.38, 0.53],
  [-0.48, 0.85],
  [-0.47, 1.28],
  [-0.44, 1.76],
  [-0.36, 2.25],
  [-0.22, 2.48],
  [-0.02, 2.46],
  [0.14, 2.31],
  [0.37, 2.21],
  [0.59, 2.05],
  [0.63, 1.92],
  [0.5, 1.81],
  [0.18, 1.96],
  [0.015, 1.88],
  [0.14, 1.53],
  [0.22, 1.17],
  [0.28, 0.81],
  [0.39, 0.53],
]

function capsule(point: Point3, a: Point3, b: Point3, radius: number) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2]
  const x = point[0] - a[0],
    y = point[1] - a[1],
    z = point[2] - a[2]
  const t = Math.max(
    0,
    Math.min(1, (x * dx + y * dy + z * dz) / (dx * dx + dy * dy + dz * dz)),
  )
  return Math.hypot(x - t * dx, y - t * dy, z - t * dz) - radius
}

/** A conservative distance field under nonuniform scale keeps the exact ellipsoid boundary. */
function ellipsoid(point: Point3, center: Point3, radii: Point3) {
  return (
    (Math.hypot(
      (point[0] - center[0]) / radii[0],
      (point[1] - center[1]) / radii[1],
      (point[2] - center[2]) / radii[2],
    ) -
      1) *
    Math.min(...radii)
  )
}

function horseProfile(x: number, y: number) {
  let squared = Infinity,
    inside = false
  for (let i = 0, j = HORSE.length - 1; i < HORSE.length; j = i++) {
    const a = HORSE[i]!,
      b = HORSE[j]!,
      dx = b[0] - a[0],
      dy = b[1] - a[1]
    const t = Math.max(
      0,
      Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)),
    )
    squared = Math.min(
      squared,
      (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2,
    )
    if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) * dx) / dy)
      inside = !inside
  }
  return (inside ? -1 : 1) * Math.sqrt(squared)
}

function knight(point: Point3) {
  const profile = horseProfile(point[0], point[1])
  const depth =
    Math.abs(point[2]) -
    (0.135 + 0.06 * Math.exp(-(((point[1] - 1) / 0.65) ** 2)))
  const body =
    Math.hypot(Math.max(profile, 0), Math.max(depth, 0)) +
    Math.min(Math.max(profile, depth), 0) -
    0.085
  let field = smoothUnion(roundedLathe(point, KNIGHT_FOOT, 0.025), body, 0.075)
  field = smoothUnion(
    field,
    ellipsoid(point, [0.08, 2.17, 0], [0.27, 0.27, 0.24]),
    0.055,
  )
  field = smoothUnion(
    field,
    ellipsoid(point, [0.51, 1.99, 0], [0.22, 0.155, 0.21]),
    0.055,
  )
  // A continuous ridge carries five large mane scallops instead of unconnected small ornaments.
  field = smoothUnion(
    field,
    capsule(point, [-0.48, 1.02, 0], [-0.43, 2.28, 0], 0.135),
    0.04,
  )
  for (let i = 0; i < 5; i++) {
    const y = 1.12 + i * 0.24,
      x = -0.48 + i * 0.012
    field = smoothUnion(
      field,
      capsule(point, [x, y + 0.12, 0], [x - 0.15, y, 0], 0.085),
      0.025,
    )
  }
  for (const side of [-1, 1]) {
    field = smoothUnion(
      field,
      capsule(
        point,
        [-0.16, 2.38, side * 0.15],
        [-0.18, 2.72, side * 0.19],
        0.11,
      ),
      0.045,
    )
    field = Math.max(
      field,
      -ellipsoid(point, [0.12, 2.27, side * 0.25], [0.1, 0.09, 0.095]),
    )
    field = Math.max(field, -sphere(point, [0.63, 2.04, side * 0.18], 0.075))
    field = Math.max(
      field,
      -capsule(
        point,
        [0.43, 1.895, side * 0.19],
        [0.67, 1.93, side * 0.16],
        0.065,
      ),
    )
  }
  return field
}

function pawn(point: Point3) {
  let field = smoothUnion(
    roundedLathe(point, PAWN, 0.025),
    sphere(point, [0, 1.995, 0], 0.37),
    0.07,
  )
  for (const side of [-1, 1])
    field = smoothUnion(field, sphere(point, [side * 0.3, 2.36, 0], 0.15), 0.04)
  return field
}

function rook(point: Point3) {
  let field = roundedLathe(point, ROOK, 0.025)
  for (const side of [-1, 1]) {
    field = smoothUnion(
      field,
      roundedBox(point, [side * 0.42, 2.22, 0], [0.165, 0.245, 0.18], 0.035),
      0.035,
    )
    field = smoothUnion(
      field,
      roundedBox(point, [0, 2.22, side * 0.42], [0.18, 0.245, 0.165], 0.035),
      0.035,
    )
  }
  return field
}

function queen(point: Point3) {
  let field = roundedLathe(point, QUEEN, 0.025)
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3,
      x = Math.cos(angle),
      z = Math.sin(angle)
    field = smoothUnion(
      field,
      capsule(point, [x * 0.4, 2.23, z * 0.4], [x * 0.5, 2.62, z * 0.5], 0.105),
      0.035,
    )
    field = smoothUnion(
      field,
      sphere(point, [x * 0.5, 2.67, z * 0.5], 0.13),
      0.03,
    )
  }
  field = smoothUnion(
    field,
    capsule(point, [0, 2.32, 0], [0, 2.71, 0], 0.115),
    0.035,
  )
  return smoothUnion(field, sphere(point, [0, 2.8, 0], 0.125), 0.025)
}

export function gummySculptedChessField(
  point: Point3,
  mould: GummyChessMould,
): number {
  if (mould === 'pawn') return pawn(point)
  if (mould === 'rook') return rook(point)
  if (mould === 'knight') return knight(point)
  if (mould === 'queen') return queen(point)
  if (mould === 'bishop') {
    let field = roundedLathe(point, BISHOP, 0.025)
    field = smoothUnion(field, sphere(point, [0, 2.7, 0], 0.095), 0.03)
    return Math.max(
      field,
      -capsule([point[0], point[1], 0], [-0.04, 2.2, 0], [0.55, 2.8, 0], 0.1),
    )
  }
  let field = roundedLathe(point, KING, 0.025)
  field = smoothUnion(field, sphere(point, [0, 2.57, 0], 0.18), 0.04)
  field = smoothUnion(
    field,
    roundedBox(point, [0, 2.94, 0], [0.115, 0.305, 0.105], 0.035),
    0.025,
  )
  return smoothUnion(
    field,
    roundedBox(point, [0, 3, 0], [0.33, 0.105, 0.105], 0.035),
    0.025,
  )
}
