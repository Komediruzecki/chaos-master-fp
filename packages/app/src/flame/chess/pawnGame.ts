/**
 * Pure pawn-race rules for the fractal board: ordinary pawn movement and en
 * passant, with a win for reaching the far rank, taking the last opponent,
 * or leaving the opponent without a legal move. There are no kings or promotion.
 * Rank 0 is Frost's edge; light advances toward rank 7 and dark toward rank 0.
 */
import type { PawnSide } from './pawnFlame'

export type Square = { file: number; rank: number }
export type Piece = {
  id: string
  side: PawnSide
  square: Square
  moved: boolean
}
export type PawnGameMode = 'standard' | 'capture-demo'
export type PawnMoveKind = 'advance' | 'double' | 'capture' | 'en-passant'
export type PawnWinReason = 'finish' | 'elimination' | 'blocked'

export type PawnMove = {
  readonly pieceId: string
  readonly from: Readonly<Square>
  readonly to: Readonly<Square>
  readonly kind: PawnMoveKind
  readonly captureId?: string
}

type CapturedPawn = Readonly<Omit<Piece, 'square'>> & {
  readonly square: Readonly<Square>
}

export type PawnMoveReceipt = Readonly<
  PawnMove & {
    ply: number
    side: PawnSide
    captured?: CapturedPawn
    enPassant: boolean
  }
>

export type GameState = {
  pieces: Piece[]
  turn: PawnSide
  selectedId?: string
  winner?: PawnSide
  winReason?: PawnWinReason
  history: PawnMoveReceipt[]
}

export type PawnMoveResult = { state: GameState; receipt: PawnMoveReceipt }

const direction = (side: PawnSide) => (side === 'light' ? 1 : -1)
const homeRank = (side: PawnSide) => (side === 'light' ? 1 : 6)
const farRank = (side: PawnSide) => (side === 'light' ? 7 : 0)
const otherSide = (side: PawnSide): PawnSide =>
  side === 'light' ? 'dark' : 'light'

function inside(square: Readonly<Square>) {
  return (
    Number.isInteger(square.file) &&
    Number.isInteger(square.rank) &&
    square.file >= 0 &&
    square.file < 8 &&
    square.rank >= 0 &&
    square.rank < 8
  )
}

function sameSquare(a: Readonly<Square>, b: Readonly<Square>) {
  return a.file === b.file && a.rank === b.rank
}

function pieceAt(state: GameState, square: Readonly<Square>) {
  return state.pieces.find((piece) => sameSquare(piece.square, square))
}

/** Board notation for visible labels and accessible square names. */
export function squareName(square: Readonly<Square>): string {
  if (!inside(square))
    throw new RangeError('A pawn square must be on the 8 by 8 board')
  return `${String.fromCharCode(97 + square.file)}${square.rank + 1}`
}

/** Each new game owns its pieces and history; the demo offers d4 takes e5. */
export function createPawnGame(mode: PawnGameMode = 'standard'): GameState {
  const pieces: Piece[] = []
  for (const side of ['light', 'dark'] as const) {
    for (let file = 0; file < 8; file++) {
      const demoPawn =
        mode === 'capture-demo' &&
        ((side === 'light' && file === 3) || (side === 'dark' && file === 4))
      pieces.push({
        id: `${side}_${file}`,
        side,
        square: {
          file,
          rank: demoPawn ? (side === 'light' ? 3 : 4) : homeRank(side),
        },
        moved: demoPawn,
      })
    }
  }
  return { pieces, turn: 'light', history: [] }
}

/** Only the immediately preceding, still-adjacent double step can be captured. */
function enPassantVictim(state: GameState, piece: Piece, file: number) {
  const last = state.history.at(-1)
  if (
    !last ||
    last.kind !== 'double' ||
    last.side === piece.side ||
    last.from.rank !== homeRank(last.side) ||
    last.to.rank !== last.from.rank + 2 * direction(last.side) ||
    last.from.file !== file ||
    last.to.file !== file ||
    last.to.rank !== piece.square.rank
  )
    return undefined
  const victim = pieceAt(state, { file, rank: piece.square.rank })
  return victim?.id === last.pieceId && victim.side !== piece.side
    ? victim
    : undefined
}

/** Legal destinations for a pawn of the current player; never mutates the board. */
export function legalPawnMoves(state: GameState, pieceId: string): PawnMove[] {
  if (state.winner) return []
  const piece = state.pieces.find((candidate) => candidate.id === pieceId)
  if (!piece || piece.side !== state.turn || !inside(piece.square)) return []
  const moves: PawnMove[] = []
  const from = { ...piece.square }
  const rank = piece.square.rank + direction(piece.side)
  const forward = { file: piece.square.file, rank }
  if (inside(forward) && !pieceAt(state, forward)) {
    moves.push({ pieceId, from, to: forward, kind: 'advance' })
    const two = { file: piece.square.file, rank: rank + direction(piece.side) }
    if (
      !piece.moved &&
      piece.square.rank === homeRank(piece.side) &&
      inside(two) &&
      !pieceAt(state, two)
    ) {
      moves.push({ pieceId, from, to: two, kind: 'double' })
    }
  }
  for (const file of [piece.square.file - 1, piece.square.file + 1]) {
    const to = { file, rank }
    if (!inside(to)) continue
    const occupant = pieceAt(state, to)
    if (occupant) {
      if (occupant.side !== piece.side) {
        moves.push({
          pieceId,
          from,
          to,
          kind: 'capture',
          captureId: occupant.id,
        })
      }
    } else {
      const victim = enPassantVictim(state, piece, file)
      if (victim)
        moves.push({
          pieceId,
          from,
          to,
          kind: 'en-passant',
          captureId: victim.id,
        })
    }
  }
  return moves
}

/** Select your own pawn, toggle it off, or clear; finished games stay unchanged. */
export function selectPawn(state: GameState, id?: string): GameState {
  if (state.winner) return state
  if (id === undefined)
    return state.selectedId === undefined
      ? state
      : { ...state, selectedId: undefined }
  const piece = state.pieces.find((candidate) => candidate.id === id)
  if (!piece || piece.side !== state.turn) return state
  return { ...state, selectedId: state.selectedId === id ? undefined : id }
}

/** Frozen snapshots let the renderer retain the captured pawn after removal. */
function moveReceipt(
  state: GameState,
  piece: Piece,
  move: PawnMove,
): PawnMoveReceipt {
  const captured = move.captureId
    ? state.pieces.find((candidate) => candidate.id === move.captureId)
    : undefined
  return Object.freeze({
    ...move,
    ply: state.history.length + 1,
    side: piece.side,
    from: Object.freeze({ ...move.from }),
    to: Object.freeze({ ...move.to }),
    ...(captured && {
      captured: Object.freeze({
        ...captured,
        square: Object.freeze({ ...captured.square }),
      }),
    }),
    enPassant: move.kind === 'en-passant',
  })
}

/** Apply a legal move or return undefined. A blocked next player loses the race. */
export function movePawn(
  state: GameState,
  pieceId: string,
  to: Square,
): PawnMoveResult | undefined {
  if (!inside(to)) return undefined
  const move = legalPawnMoves(state, pieceId).find((candidate) =>
    sameSquare(candidate.to, to),
  )
  const piece = state.pieces.find((candidate) => candidate.id === pieceId)
  if (!move || !piece) return undefined
  const receipt = moveReceipt(state, piece, move)
  const next: GameState = {
    pieces: state.pieces
      .filter((candidate) => candidate.id !== move.captureId)
      .map((candidate) =>
        candidate.id === pieceId
          ? { ...candidate, square: { ...to }, moved: true }
          : candidate,
      ),
    turn: otherSide(piece.side),
    history: [...state.history, receipt],
  }
  let reason: PawnWinReason | undefined
  if (to.rank === farRank(piece.side)) reason = 'finish'
  else if (!next.pieces.some((candidate) => candidate.side === next.turn))
    reason = 'elimination'
  else if (
    !next.pieces.some(
      (candidate) =>
        candidate.side === next.turn &&
        legalPawnMoves(next, candidate.id).length > 0,
    )
  )
    reason = 'blocked'
  if (reason) {
    next.winner = piece.side
    next.winReason = reason
  }
  return { state: next, receipt }
}
