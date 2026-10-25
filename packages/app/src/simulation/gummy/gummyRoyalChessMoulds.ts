/** Rounded Staunton bishop, horse knight, coronet queen and cross king for filled candy volumes. */
import { BASE_PROFILE, roundedLathe, smoothUnion, sphere, } from './gummyChessFields'
import type { Point3, ProfilePoint } from './gummyChessFields'

const BISHOP_PROFILE: readonly ProfilePoint[] = [
  ...BASE_PROFILE,
  [0.42, 0.66],
  [0.31, 1.04],
  [0.25, 1.43],
  [0.34, 1.57],
  [0.42, 1.63],
  [0.4, 1.72],
  [0.23, 1.79],
  [0.33, 1.91],
  [0.4, 2.09],
  [0.35, 2.32],
  [0.19, 2.56],
  [0.06, 2.71],
  [0, 2.74],
]
const QUEEN_PROFILE: readonly ProfilePoint[] = [
  ...BASE_PROFILE,
  [0.43, 0.65],
  [0.31, 1.05],
  [0.25, 1.5],
  [0.32, 1.69],
  [0.43, 1.76],
  [0.44, 1.85],
  [0.31, 1.93],
  [0.34, 2.05],
  [0.47, 2.26],
  [0.53, 2.4],
  [0, 2.4],
]
const KING_PROFILE: readonly ProfilePoint[] = [
  ...BASE_PROFILE,
  [0.44, 0.69],
  [0.33, 1.1],
  [0.28, 1.59],
  [0.35, 1.78],
  [0.44, 1.85],
  [0.45, 1.95],
  [0.32, 2.05],
  [0.32, 2.28],
  [0.4, 2.35],
  [0.37, 2.46],
  [0.23, 2.53],
  [0, 2.53],
]
const KNIGHT_BASE: readonly ProfilePoint[] = [
  ...BASE_PROFILE,
  [0.47, 0.57],
  [0.39, 0.66],
  [0, 0.66],
]
// The +X muzzle and the concave throat form an actual horse profile, not a turned chess head.
const HORSE_OUTLINE: readonly (readonly [number, number])[] = [
  [-0.46, 0.48],
  [-0.55, 0.8],
  [-0.54, 1.25],
  [-0.51, 1.75],
  [-0.42, 2.25],
  [-0.29, 2.53],
  [-0.05, 2.49],
  [0.12, 2.33],
  [0.37, 2.24],
  [0.6, 2.03],
  [0.62, 1.86],
  [0.44, 1.78],
  [0.15, 1.94],
  [0, 1.9],
  [0.18, 1.52],
  [0.26, 1.15],
  [0.34, 0.75],
  [0.48, 0.49],
]

function capsule(point: Point3, a: Point3, b: Point3, radius: number) {
  const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const offset = [point[0] - a[0], point[1] - a[1], point[2] - a[2]]
  const t = Math.max(
    0,
    Math.min(
      1,
      (offset[0]! * delta[0]! +
        offset[1]! * delta[1]! +
        offset[2]! * delta[2]!) /
        (delta[0]! ** 2 + delta[1]! ** 2 + delta[2]! ** 2),
    ),
  )
  return (
    Math.hypot(
      offset[0]! - t * delta[0]!,
      offset[1]! - t * delta[1]!,
      offset[2]! - t * delta[2]!,
    ) - radius
  )
}

function horseProfileDistance(x: number, y: number) {
  let squared = Infinity,
    inside = false
  for (
    let i = 0, j = HORSE_OUTLINE.length - 1;
    i < HORSE_OUTLINE.length;
    j = i++
  ) {
    const a = HORSE_OUTLINE[i]!,
      b = HORSE_OUTLINE[j]!
    const dx = b[0] - a[0],
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

function knightField(point: Point3) {
  const profile = horseProfileDistance(point[0], point[1])
  const depth =
    Math.abs(point[2]) -
    (0.18 + 0.05 * Math.exp(-(((point[1] - 1.0) / 0.65) ** 2)))
  const horse =
    Math.hypot(Math.max(profile, 0), Math.max(depth, 0)) +
    Math.min(Math.max(profile, depth), 0) -
    0.1
  let field = smoothUnion(roundedLathe(point, KNIGHT_BASE), horse, 0.1)
  for (const side of [-1, 1]) {
    field = smoothUnion(
      field,
      capsule(
        point,
        [-0.22, 2.43, side * 0.17],
        [-0.2, 2.72, side * 0.2],
        0.13,
      ),
      0.055,
    )
    // Small eye impressions stay optional at coarse resolution; they never disconnect the head.
    field = Math.max(field, -sphere(point, [0.13, 2.28, side * 0.295], 0.067))
  }
  return field
}

function bishopField(point: Point3) {
  const body = roundedLathe(point, BISHOP_PROFILE)
  // A finite diagonal cut opens one side while retaining a thick bridge below the mitre.
  const slit = capsule(
    [point[0], point[1], 0],
    [-0.02, 2.26, 0],
    [0.62, 2.89, 0],
    0.115,
  )
  return Math.max(body, -slit)
}

function queenField(point: Point3) {
  let field = roundedLathe(point, QUEEN_PROFILE)
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3
    const x = Math.cos(angle),
      z = Math.sin(angle)
    field = smoothUnion(
      field,
      capsule(
        point,
        [x * 0.43, 2.28, z * 0.43],
        [x * 0.55, 2.68, z * 0.55],
        0.145,
      ),
      0.055,
    )
  }
  field = smoothUnion(
    field,
    capsule(point, [0, 2.3, 0], [0, 2.67, 0], 0.14),
    0.055,
  )
  return smoothUnion(field, sphere(point, [0, 2.77, 0], 0.17), 0.045)
}

function kingField(point: Point3) {
  let field = roundedLathe(point, KING_PROFILE)
  field = smoothUnion(field, sphere(point, [0, 2.56, 0], 0.21), 0.05)
  field = smoothUnion(
    field,
    capsule(point, [0, 2.57, 0], [0, 3.18, 0], 0.14),
    0.04,
  )
  return smoothUnion(
    field,
    capsule(point, [-0.27, 2.96, 0], [0.27, 2.96, 0], 0.14),
    0.04,
  )
}

export function gummyRoyalChessField(
  point: Point3,
  mould: 'knight' | 'bishop' | 'queen' | 'king',
) {
  if (mould === 'knight') return knightField(point)
  if (mould === 'bishop') return bishopField(point)
  if (mould === 'queen') return queenField(point)
  return kingField(point)
}
