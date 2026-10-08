/** A simulation-time capture leaves the attacking rook on its opponent's square. */
import { gummyBoardGridCentre } from './gummyBoardGrid'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { GummyVec3 } from '@/components/GummyBear/gummyStudyMath'
import type { GummyChessMould } from '@/simulation/gummy/gummyChessMoulds'

export type GummyBoardPhase =
  | 'ready'
  | 'lifting'
  | 'aiming'
  | 'crushing'
  | 'releasing'
  | 'settling'
  | 'complete'
export type GummyBoardPiece = {
  id: number
  mould: GummyChessMould
  position: GummyVec3
  side: 0 | 1
  square: string
  rotationY: number
}
export const GUMMY_BOARD_VICTIM_ID = 21
export const GUMMY_BOARD_ATTACKER_ID = 1
export const GUMMY_BOARD_VICTIM_POSITION: GummyVec3 = [0.8, 0, 0.8]
export const GUMMY_BOARD_ROOK_START: GummyVec3 = [-3.2, 0, 0]
export const GUMMY_BOARD_ROOK_FINISH: GummyVec3 = [0, 0.24, 0]

/** Standard opening, with a1 at near-left and each queen on her own colour. */
export function createGummyBoardPieces(): GummyBoardPiece[] {
  const pieces: GummyBoardPiece[] = []
  const backRank: GummyChessMould[] = [
    'rook',
    'knight',
    'bishop',
    'queen',
    'king',
    'bishop',
    'knight',
    'rook',
  ]
  for (const rank of [0, 1, 6, 7])
    for (let file = 0; file < 8; file++) {
      const id = pieces.length + 1
      const position = gummyBoardGridCentre(file, rank)
      const mould = rank === 1 || rank === 6 ? 'pawn' : backRank[file]!
      pieces.push({
        id,
        mould,
        position,
        side: rank < 4 ? 0 : 1,
        square: `${'abcdefgh'[file]}${rank + 1}`,
        rotationY:
          mould === 'knight' ? (rank < 4 ? Math.PI / 2 : -Math.PI / 2) : 0,
      })
    }
  return pieces
}

/** Warm and cool accents distinguish the minor pieces; explicit edits always win. */
export function getGummyBoardPiecePalette(
  piece: Pick<GummyBoardPiece, 'id' | 'mould' | 'side'>,
  basePalette: GummyPalette,
  overrides: Partial<Record<number, GummyPalette>> = {},
): GummyPalette {
  if (overrides[piece.id]) return overrides[piece.id]!
  if (piece.mould === 'bishop') return piece.side === 0 ? 'lagoon' : 'berry'
  if (piece.mould === 'knight') return piece.side === 0 ? 'amber' : 'blue'
  return basePalette
}

function impactScale(impact: number) {
  return Number.isFinite(impact) ? Math.max(0.5, Math.min(1.5, impact)) : 1
}

export function gummyBoardCrashDuration(impact: number) {
  return 5.2 + 0.8 / impactScale(impact)
}

/** C1-continuous motion. Collider and render use this same translation, in pawn-local coordinates. */
export function gummyBoardRookPose(
  time: number,
  impact = 1,
): {
  position: GummyVec3
  phase: GummyBoardPhase
} {
  const duration = 0.8 / impactScale(impact)
  const stages: { seconds: number; to: GummyVec3; phase: GummyBoardPhase }[] = [
    { seconds: 0.3, to: [-3.2, 0, 0], phase: 'ready' },
    { seconds: 1.25, to: [-3.2, 3.1, 0], phase: 'lifting' },
    { seconds: 0.85, to: [0, 3.1, 0], phase: 'aiming' },
    { seconds: duration, to: [0, 0.3, 0], phase: 'crushing' },
    { seconds: 0.35, to: [0, 0.3, 0], phase: 'crushing' },
    { seconds: 0.4, to: [0.18, 0.28, 0], phase: 'crushing' },
    { seconds: 0.4, to: GUMMY_BOARD_ROOK_FINISH, phase: 'settling' },
    { seconds: 1.65, to: GUMMY_BOARD_ROOK_FINISH, phase: 'settling' },
  ]
  let remaining = Number.isFinite(time) ? Math.max(0, time) : 0
  let from: GummyVec3 = [...GUMMY_BOARD_ROOK_START]
  for (const stage of stages) {
    if (remaining < stage.seconds) {
      const t = remaining / stage.seconds
      const blend = t * t * (3 - 2 * t)
      return {
        position: from.map(
          (value, axis) => value + (stage.to[axis]! - value) * blend,
        ) as GummyVec3,
        phase: stage.phase,
      }
    }
    remaining -= stage.seconds
    from = stage.to
  }
  return { position: [...GUMMY_BOARD_ROOK_FINISH], phase: 'complete' }
}

/** A constant velocity over one tick ends exactly at the pose rendered after that tick. */
export function gummyBoardRookStep(time: number, dt: number, impact = 1) {
  if (!Number.isFinite(dt) || dt <= 0)
    throw new RangeError('A rook step needs a positive finite timestep')
  const start = gummyBoardRookPose(time, impact)
  const end = gummyBoardRookPose(time + dt, impact)
  const velocity = start.position.map(
    (value, axis) => (end.position[axis]! - value) / dt,
  ) as GummyVec3
  return { position: start.position, velocity, friction: 0.45 }
}
