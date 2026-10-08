/** Filled, rounded chess moulds sampled in the jelly solver's existing material coordinates. */
import { authoredPawnField, sampleAuthoredPawn } from './gummyAuthoredPawn'
import { BASE_PROFILE, roundedBox, roundedLathe, smoothUnion, sphere, } from './gummyChessFields'
import { gummyRoyalChessField } from './gummyRoyalChessMoulds'
import { gummySculptedChessField } from './gummySculptedChessMoulds'
import type { GummyAuthoredPawn } from './gummyAuthoredPawn'
import type { Point3, ProfilePoint } from './gummyChessFields'

export type GummyChessMould =
  | 'pawn'
  | 'rook'
  | 'knight'
  | 'bishop'
  | 'queen'
  | 'king'
export type GummyChessArtStyle = 'classic' | 'sculpted'

export const GUMMY_CHESS_MOULDS = {
  pawn: {
    bounds: { min: [-0.82, 0, -0.82], max: [0.82, 2.65, 0.82] },
    pinHeight: 0.22,
  },
  rook: {
    bounds: { min: [-0.82, 0, -0.82], max: [0.82, 2.54, 0.82] },
    pinHeight: 0.22,
  },
  knight: {
    bounds: { min: [-0.82, 0, -0.82], max: [0.88, 2.94, 0.82] },
    pinHeight: 0.22,
  },
  bishop: {
    bounds: { min: [-0.82, 0, -0.82], max: [0.82, 2.84, 0.82] },
    pinHeight: 0.22,
  },
  queen: {
    bounds: { min: [-0.82, 0, -0.82], max: [0.82, 3.02, 0.82] },
    pinHeight: 0.22,
  },
  king: {
    bounds: { min: [-0.82, 0, -0.82], max: [0.82, 3.38, 0.82] },
    pinHeight: 0.22,
  },
} as const

export function isGummyChessMould(value: string): value is GummyChessMould {
  return Object.hasOwn(GUMMY_CHESS_MOULDS, value)
}

const PAWN_PROFILE: readonly ProfilePoint[] = [
  ...BASE_PROFILE,
  [0.42, 0.65],
  [0.32, 0.93],
  [0.26, 1.2],
  [0.27, 1.38],
  [0.39, 1.46],
  [0.4, 1.53],
  [0.31, 1.61],
  [0.25, 1.74],
  [0, 1.74],
]
export const GUMMY_ROOK_PROFILE: readonly ProfilePoint[] = [
  ...BASE_PROFILE,
  [0.43, 0.72],
  [0.35, 1.05],
  [0.34, 1.36],
  [0.4, 1.61],
  [0.52, 1.7],
  [0.6, 1.75],
  [0.62, 1.88],
  [0.61, 2.12],
  [0, 2.12],
]

export const GUMMY_ROOK_MERLONS = [
  { center: [-0.48, 2.28, 0], half: [0.2, 0.24, 0.21] },
  { center: [0, 2.28, -0.48], half: [0.21, 0.24, 0.2] },
  { center: [0.48, 2.28, 0], half: [0.2, 0.24, 0.21] },
  { center: [0, 2.28, 0.48], half: [0.21, 0.24, 0.2] },
] as const
export const GUMMY_ROOK_EDGE_RADIUS = 0.06
export const GUMMY_ROOK_MERLON_RADIUS = 0.075
export const GUMMY_ROOK_BLEND = 0.06

/** Negative values describe candy throughout the interior; colour uses these same rest coordinates. */
export function gummyChessField(
  point: Point3,
  mould: GummyChessMould,
  artStyle: GummyChessArtStyle = 'classic',
  authoredPawn?: GummyAuthoredPawn,
): number {
  if (mould === 'pawn' && authoredPawn)
    return authoredPawnField(point, authoredPawn)
  if (artStyle === 'sculpted') return gummySculptedChessField(point, mould)
  if (mould !== 'pawn' && mould !== 'rook')
    return gummyRoyalChessField(point, mould)
  if (mould === 'pawn') {
    let field = smoothUnion(
      roundedLathe(point, PAWN_PROFILE),
      sphere(point, [0, 1.98, 0], 0.41),
      0.1,
    )
    // Lift the lobes above the sphere: ears beside its upper corners flatten the silhouette.
    for (const x of [-0.34, 0.34])
      field = smoothUnion(field, sphere(point, [x, 2.4, 0], 0.17), 0.06)
    return field
  }
  let field = roundedLathe(point, GUMMY_ROOK_PROFILE)
  // Four broad merlons overlap the filled crown beneath their rounded slots.
  for (const merlon of GUMMY_ROOK_MERLONS) {
    field = smoothUnion(
      field,
      roundedBox(point, merlon.center, merlon.half, GUMMY_ROOK_MERLON_RADIUS),
      GUMMY_ROOK_BLEND,
    )
  }
  return field
}

/** Equal-volume lattice cells; anchoring is confined to the bottom of the broad base. */
export function sampleGummyChessMould(
  mould: GummyChessMould,
  spacing: number,
  pinHeight: number = GUMMY_CHESS_MOULDS[mould].pinHeight,
  artStyle: GummyChessArtStyle = 'classic',
  authoredPawn?: GummyAuthoredPawn,
): number[] {
  if (!Number.isFinite(spacing) || spacing < 0.06 || spacing > 0.12)
    throw new RangeError('Particle spacing must be between 0.06 and 0.12')
  if (!Number.isFinite(pinHeight) || pinHeight < 0 || pinHeight > 0.6)
    throw new RangeError('Particle pin height must be between zero and 0.6')
  const { bounds } = GUMMY_CHESS_MOULDS[mould]
  const basePinHeight = Math.min(pinHeight, GUMMY_CHESS_MOULDS[mould].pinHeight)
  if (mould === 'pawn' && authoredPawn)
    return sampleAuthoredPawn(authoredPawn, spacing, basePinHeight)
  const points: number[] = []
  for (
    let iy = Math.floor(bounds.min[1] / spacing);
    iy * spacing < bounds.max[1];
    iy++
  )
    for (
      let iz = Math.floor(bounds.min[2] / spacing);
      iz * spacing < bounds.max[2];
      iz++
    )
      for (
        let ix = Math.floor(bounds.min[0] / spacing);
        ix * spacing < bounds.max[0];
        ix++
      ) {
        const x = (ix + 0.5) * spacing,
          y = (iy + 0.5) * spacing,
          z = (iz + 0.5) * spacing
        if (gummyChessField([x, y, z], mould, artStyle) > 0) continue
        points.push(x, y, z, y < basePinHeight ? 0 : 1)
      }
  return points
}
