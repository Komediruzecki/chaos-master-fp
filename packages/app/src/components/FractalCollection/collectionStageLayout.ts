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
export type CollectionEnclosure = 'pure' | 'glass' | 'both'
export type CollectionGlassSelection = {
  role?: ChessCandidateRole
  key: string
  enclosure: CollectionEnclosure
}
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
  glass?: CollectionGlassSelection,
): CollectionInstance[] {
  const instance = (
    pieceRole: ChessCandidateRole,
    pieceSide: PawnSide,
    position: readonly [number, number, number],
    index: number,
    square?: Square,
    enclosed = false,
  ): CollectionInstance => ({
    role: pieceRole,
    side: pieceSide,
    position,
    square,
    selected: pieceRole === role && pieceSide === side,
    age: -1,
    cloudKey: `${pieceRole}:${pieceSide}`,
    glassKey: enclosed ? glass?.key : undefined,
    scale: 0.9,
    colorMultiplier: variation
      ? [1 + ((index % 5) - 2) * 0.025, 1, 1 - ((index % 5) - 2) * 0.025]
      : [1, 1, 1],
  })
  const hasGlass = (item: ChessCandidateRole) =>
    glass?.role === item && glass.enclosure !== 'pure'
  if (mode === 'solo') {
    if (hasGlass(role) && glass?.enclosure === 'both')
      return [
        instance(role, side, [-0.85, 0.09, 0], 0),
        instance(role, side, [0.85, 0.09, 0], 0, undefined, true),
      ]
    return [instance(role, side, [0, 0.09, 0], 0, undefined, hasGlass(role))]
  }
  if (mode === 'lineup') {
    const roles = CHESS_CANDIDATE_ROLES.flatMap((item, index) =>
      hasGlass(item) && glass?.enclosure === 'both'
        ? [
            { role: item, index, enclosed: false },
            { role: item, index, enclosed: true },
          ]
        : [{ role: item, index, enclosed: hasGlass(item) }],
    )
    return roles.map((item, index) =>
      instance(
        item.role,
        side,
        [(index - (roles.length - 1) / 2) * 1.85, 0.09, 0],
        item.index,
        undefined,
        item.enclosed,
      ),
    )
  }
  const result: CollectionInstance[] = []
  for (const pieceSide of ['light', 'dark'] as const)
    for (let file = 0; file < 8; file++) {
      for (const rank of pieceSide === 'light' ? [0, 1] : [7, 6]) {
        const square = { file, rank }
        const pieceRole = rank === 1 || rank === 6 ? 'pawn' : BACK_RANK[file]!
        result.push(
          instance(
            pieceRole,
            pieceSide,
            squareWorld(square),
            hasGlass(pieceRole) && glass?.enclosure === 'both'
              ? Math.min(file, 7 - file)
              : file,
            square,
            hasGlass(pieceRole) && (glass?.enclosure === 'glass' || file >= 4),
          ),
        )
      }
    }
  return result
}
