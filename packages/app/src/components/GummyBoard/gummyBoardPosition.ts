/** FEN positions and occupied-square captures for the cinematic chess studies. */
import { gummyBoardGridCentre } from './gummyBoardGrid'
import type { GummyBoardPiece } from './gummyBoardChoreography'
import type { GummyVec3 } from '@/components/GummyBear/gummyStudyMath'
import type { GummyChessMould } from '@/simulation/gummy/gummyChessMoulds'

const PIECES: Readonly<Record<string, GummyChessMould>> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}
export type GummyBoardPosition = {
  pieces: GummyBoardPiece[]
  sideToMove: 0 | 1
}

export function gummyBoardSquare(square: string): {
  file: number
  rank: number
  position: GummyVec3
} {
  if (!/^[a-h][1-8]$/.test(square))
    throw new Error('Use a square from a1 to h8.')
  const file = square.charCodeAt(0) - 97,
    rank = Number(square[1]) - 1
  return {
    file,
    rank,
    position: gummyBoardGridCentre(file, rank),
  }
}

function parsePlacement(placement: string) {
  const rows = placement.split('/')
  if (rows.length !== 8) throw new Error('FEN must contain eight board ranks.')
  const pieces: GummyBoardPiece[] = []
  for (const [row, text] of rows.entries()) {
    let file = 0
    for (const char of text) {
      if (/^[1-8]$/.test(char)) file += Number(char)
      else {
        const mould = PIECES[char.toLowerCase()]
        if (!mould || file >= 8)
          throw new Error('FEN contains an invalid piece or rank.')
        const rank = 7 - row,
          side = char === char.toUpperCase() ? 0 : 1
        if (mould === 'pawn' && (rank === 0 || rank === 7))
          throw new Error('Place pawns on ranks 2 to 7.')
        const square = `${String.fromCharCode(97 + file)}${rank + 1}`
        pieces.push({
          id: rank * 8 + file + 1,
          mould,
          square,
          side,
          position: gummyBoardSquare(square).position,
          rotationY:
            mould === 'knight' ? (side === 0 ? Math.PI / 2 : -Math.PI / 2) : 0,
        })
        file++
      }
    }
    if (file !== 8)
      throw new Error('Each FEN rank must describe eight squares.')
  }
  for (const side of [0, 1]) {
    const sidePieces = pieces.filter((piece) => piece.side === side)
    if (sidePieces.filter((piece) => piece.mould === 'king').length !== 1)
      throw new Error('The position needs exactly one king for each side.')
    if (
      sidePieces.length > 16 ||
      sidePieces.filter((piece) => piece.mould === 'pawn').length > 8
    )
      throw new Error(
        'Each side can have at most sixteen pieces and eight pawns.',
      )
  }
  return pieces.sort((a, b) => a.id - b.id)
}

function attacks(
  piece: GummyBoardPiece,
  target: string,
  pieces: readonly GummyBoardPiece[],
) {
  const source = gummyBoardSquare(piece.square),
    end = gummyBoardSquare(target)
  const dx = end.file - source.file,
    dy = end.rank - source.rank
  const x = Math.abs(dx),
    y = Math.abs(dy)
  if (!x && !y) return false
  if (piece.mould === 'pawn')
    return x === 1 && dy === (piece.side === 0 ? 1 : -1)
  if (piece.mould === 'knight') return x * y === 2
  if (piece.mould === 'king') return Math.max(x, y) === 1
  const straight = x === 0 || y === 0,
    diagonal = x === y
  if (
    (piece.mould === 'rook' && !straight) ||
    (piece.mould === 'bishop' && !diagonal) ||
    (piece.mould === 'queen' && !straight && !diagonal)
  )
    return false
  for (let step = 1; step < Math.max(x, y); step++) {
    const square = `${String.fromCharCode(97 + source.file + Math.sign(dx) * step)}${source.rank + Math.sign(dy) * step + 1}`
    if (pieces.some((candidate) => candidate.square === square)) return false
  }
  return true
}

function kingAttacked(pieces: readonly GummyBoardPiece[], side: 0 | 1) {
  const king = pieces.find(
    (piece) => piece.side === side && piece.mould === 'king',
  )!
  return pieces.some(
    (piece) => piece.side !== side && attacks(piece, king.square, pieces),
  )
}

function validateFenState(
  fields: string[],
  pieces: readonly GummyBoardPiece[],
  side: 0 | 1,
) {
  const castling = fields[2]!,
    ep = fields[3]!
  if (!/^(?:-|K?Q?k?q?)$/.test(castling) || !castling)
    throw new Error('Use KQkq or - for FEN castling rights.')
  for (const [right, kingSquare, rookSquare, owner] of [
    ['K', 'e1', 'h1', 0],
    ['Q', 'e1', 'a1', 0],
    ['k', 'e8', 'h8', 1],
    ['q', 'e8', 'a8', 1],
  ] as const) {
    if (
      castling.includes(right) &&
      (!pieces.some(
        (p) =>
          p.square === kingSquare && p.side === owner && p.mould === 'king',
      ) ||
        !pieces.some(
          (p) =>
            p.square === rookSquare && p.side === owner && p.mould === 'rook',
        ))
    )
      throw new Error(
        'FEN castling rights need the king and rook on their starting squares.',
      )
  }
  if (ep !== '-') {
    const square = gummyBoardSquare(ep)
    const expectedRank = side === 0 ? 5 : 2
    const pawnSquare = `${ep[0]}${side === 0 ? 5 : 4}`
    if (
      square.rank !== expectedRank ||
      pieces.some((p) => p.square === ep) ||
      !pieces.some(
        (p) => p.square === pawnSquare && p.side !== side && p.mould === 'pawn',
      )
    )
      throw new Error(
        'The FEN en-passant square does not match a pawn double move.',
      )
  }
  if (
    !/^\d+$/.test(fields[4]!) ||
    !/^[1-9]\d*$/.test(fields[5]!) ||
    !Number.isSafeInteger(Number(fields[4])) ||
    !Number.isSafeInteger(Number(fields[5]))
  )
    throw new Error(
      'FEN move counters must be nonnegative, with a full move of at least 1.',
    )
  // The side that just moved cannot have left its own king attacked.
  if (kingAttacked(pieces, side === 0 ? 1 : 0))
    throw new Error(
      'The side that just moved has left its king in check. Check the FEN turn.',
    )
}

export function parseGummyBoardFen(fen: string): GummyBoardPosition {
  if (fen.length > 256) throw new Error('The FEN position is too long.')
  const fields = fen.trim().split(/\s+/)
  if (fields.length !== 6 || !/^[wb]$/.test(fields[1]!))
    throw new Error(
      'Use a complete six-field FEN position with w or b to move.',
    )
  const pieces = parsePlacement(fields[0]!)
  const sideToMove = fields[1] === 'w' ? 0 : 1
  validateFenState(fields, pieces, sideToMove)
  return { pieces, sideToMove }
}

/** Scope is a normal capture onto an occupied square; castling and promotion need separate choreography. */
export function validateGummyBoardCapture(
  position: GummyBoardPosition,
  from: string,
  to: string,
) {
  gummyBoardSquare(from)
  const destination = gummyBoardSquare(to)
  const attacker = position.pieces.find((piece) => piece.square === from)
  const victim = position.pieces.find((piece) => piece.square === to)
  if (!attacker) throw new Error('The source square is empty.')
  if (attacker.side !== position.sideToMove)
    throw new Error('Choose a piece belonging to the side to move.')
  if (!victim)
    throw new Error(
      'Choose an occupied destination. En-passant is not supported in these shots.',
    )
  if (victim.side === attacker.side)
    throw new Error('Choose a destination occupied by the other side.')
  if (victim.mould === 'king')
    throw new Error('Kings cannot be captured. Choose another piece.')
  if (
    attacker.mould === 'pawn' &&
    (destination.rank === 0 || destination.rank === 7)
  )
    throw new Error(
      'Promotion captures need a promotion shot. Choose another move.',
    )
  if (!attacks(attacker, to, position.pieces))
    throw new Error(
      'That capture is blocked or does not follow the piece’s move.',
    )
  const after = position.pieces
    .filter((p) => p.id !== victim.id)
    .map((p) =>
      p.id === attacker.id
        ? { ...p, square: to, position: destination.position }
        : p,
    )
  if (kingAttacked(after, attacker.side))
    throw new Error('That capture leaves your king in check.')
  return { attacker, victim }
}
