/** One bounded set of native role clouds can be arranged as a match, lineup or specimen. */
import { CHESS_CANDIDATE_ROLES } from '@/flame/chess/chessCandidate'
import { squareWorld } from '../PawnBoard/pawnBoardMath'
import type { BoardPawnInstance } from '../PawnBoard/pawnBoardRenderer'
import type { ChessCandidateRole } from '@/flame/chess/chessCandidate'
import type { PawnSide } from '@/flame/chess/pawnFlame'
import type { Square } from '@/flame/chess/pawnGame'

export type CollectionView = 'board' | 'lineup' | 'solo'
export type CollectionCamera = 'perspective' | 'front' | 'top'
export type CollectionQuality = 'normal' | 'high'
export type CollectionInstance = BoardPawnInstance & {
  role: ChessCandidateRole
  square?: Square
}
const BACK_RANK: readonly ChessCandidateRole[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
]

export function collectionInstances(
  mode: CollectionView,
  role: ChessCandidateRole,
  side: PawnSide,
  variation: boolean,
): CollectionInstance[] {
  const instance = (
    pieceRole: ChessCandidateRole,
    pieceSide: PawnSide,
    position: readonly [number, number, number],
    index: number,
    square?: Square,
  ): CollectionInstance => ({
    role: pieceRole,
    side: pieceSide,
    position,
    square,
    selected: pieceRole === role && pieceSide === side,
    age: -1,
    cloudKey: `${pieceRole}:${pieceSide}`,
    scale: 0.9,
    colorMultiplier: variation
      ? [1 + ((index % 5) - 2) * 0.025, 1, 1 - ((index % 5) - 2) * 0.025]
      : [1, 1, 1],
  })
  if (mode === 'solo') return [instance(role, side, [0, 0.09, 0], 0)]
  if (mode === 'lineup')
    return CHESS_CANDIDATE_ROLES.map((item, index) =>
      instance(item, side, [(index - 2.5) * 1.85, 0.09, 0], index),
    )
  const result: CollectionInstance[] = []
  for (const pieceSide of ['light', 'dark'] as const)
    for (let file = 0; file < 8; file++) {
      for (const rank of pieceSide === 'light' ? [0, 1] : [7, 6]) {
        const square = { file, rank }
        const pieceRole = rank === 1 || rank === 6 ? 'pawn' : BACK_RANK[file]!
        result.push(
          instance(pieceRole, pieceSide, squareWorld(square), file, square),
        )
      }
    }
  return result
}
