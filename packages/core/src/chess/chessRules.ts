/** Headless legal moves with stable identities and replayable immutable presentation receipts. */
import { Chess, DEFAULT_POSITION } from 'chess.js'
import type { Move, PieceSymbol } from 'chess.js'
import type { ChessDrawClaim, ChessGame, ChessLegalMove, ChessMoveInput, ChessMoveKind, ChessMoveReceipt, ChessPiece, ChessPosition, ChessPromotion, ChessRole, ChessSquare, } from './chessTypes'

export const CHESS_START_FEN = DEFAULT_POSITION
export const CHESS_MAX_PLIES = 2000
export const CHESS_MAX_FEN_LENGTH = 256
const roles: Readonly<Record<PieceSymbol, ChessRole>> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}
const promotions: Readonly<Record<ChessPromotion, PieceSymbol>> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
}

function square(value: string): asserts value is ChessSquare {
  if (!/^[a-h][1-8]$/.test(value))
    throw new Error('Choose a square from a1 to h8.')
}

/** Validate externally supplied FEN before chess.js normalizes it. */
function initialEngine(fen: string) {
  if (typeof fen !== 'string' || fen.length > CHESS_MAX_FEN_LENGTH)
    throw new Error('Use a FEN position of at most 256 characters.')
  const fields = fen.trim().split(/\s+/)
  if (fields.length !== 6)
    throw new Error('Use a complete six-field FEN position.')
  if (!/^(?:-|K?Q?k?q?)$/.test(fields[2]!) || !fields[2])
    throw new Error('Use KQkq or - for castling rights.')
  if (
    !/^\d+$/.test(fields[4]!) ||
    !/^[1-9]\d*$/.test(fields[5]!) ||
    Number(fields[4]) > 1_000_000 ||
    Number(fields[5]) > 1_000_000
  )
    throw new Error(
      'Use whole FEN move counters between zero and one million, with a full move of at least one.',
    )
  const engine = new Chess(fields.join(' '))
  validatePieces(engine)
  validateCastling(engine, fields[2])
  validateEnPassant(engine, fields[3]!, Number(fields[4]))
  return engine
}

function validatePieces(engine: Chess) {
  const pieces = engine
    .board()
    .flat()
    .filter((piece) => piece !== null)
  for (const color of ['w', 'b'] as const) {
    const own = pieces.filter((piece) => piece.color === color)
    if (own.length > 16 || own.filter((piece) => piece.type === 'p').length > 8)
      throw new Error(
        'Each side can have at most sixteen pieces and eight pawns.',
      )
  }
  const previous = engine.turn() === 'w' ? 'b' : 'w'
  const king = pieces.find(
    (piece) => piece.color === previous && piece.type === 'k',
  )!
  if (engine.isAttacked(king.square, engine.turn()))
    throw new Error('The side that just moved has left its king in check.')
}

function validateCastling(engine: Chess, castling: string) {
  for (const [right, color, kingSquare, rookSquare] of [
    ['K', 'w', 'e1', 'h1'],
    ['Q', 'w', 'e1', 'a1'],
    ['k', 'b', 'e8', 'h8'],
    ['q', 'b', 'e8', 'a8'],
  ] as const) {
    if (
      castling.includes(right) &&
      (engine.get(kingSquare)?.type !== 'k' ||
        engine.get(kingSquare)?.color !== color ||
        engine.get(rookSquare)?.type !== 'r' ||
        engine.get(rookSquare)?.color !== color)
    )
      throw new Error(
        'Castling rights need the king and rook on their starting squares.',
      )
  }
}

function validateEnPassant(engine: Chess, target: string, halfMoves: number) {
  const previous = engine.turn() === 'w' ? 'b' : 'w'
  if (target !== '-') {
    square(target)
    const pawnSquare =
      `${target[0]}${engine.turn() === 'w' ? 5 : 4}` as ChessSquare
    const origin = `${target[0]}${engine.turn() === 'w' ? 7 : 2}` as ChessSquare
    const pawn = engine.get(pawnSquare)
    if (
      engine.get(target) ||
      engine.get(origin) ||
      pawn?.type !== 'p' ||
      pawn.color !== previous ||
      halfMoves !== 0
    )
      throw new Error('The en-passant square must follow a pawn double move.')
  }
}

function position(
  engine: Chess,
  pieces: readonly ChessPiece[],
  history: readonly Pick<ChessMoveReceipt, 'before'>[],
  doubleStepTarget?: ChessSquare,
): ChessPosition {
  const fields = engine.fen({ forceEnpassantSquare: true }).split(' ')
  // chess.js omits a new target when no opposing pawn is adjacent, even with
  // forceEnpassantSquare. Keep the full FEN target separately from repetition.
  if (doubleStepTarget) fields[3] = doubleStepTarget
  const fen = fields.join(' ')
  const repetitionKey = engine.fen().split(' ').slice(0, 4).join(' ')
  const repetitionCount = history.reduce(
    (count, move) =>
      count + Number(move.before.repetitionKey === repetitionKey),
    1,
  )
  const halfMoves = Number(fen.split(' ')[4])
  const claims: ChessDrawClaim[] = []
  let status: ChessPosition['status'] = 'active'
  let drawReason: ChessPosition['drawReason']
  let winner: ChessPosition['winner']
  if (engine.isCheckmate()) {
    status = 'checkmate'
    winner = engine.turn() === 'w' ? 'b' : 'w'
  } else if (engine.isStalemate()) status = 'stalemate'
  else if (engine.isInsufficientMaterial()) {
    status = 'draw'
    drawReason = 'insufficient-material'
  } else if (repetitionCount >= 5) {
    status = 'draw'
    drawReason = 'fivefold-repetition'
  } else if (halfMoves >= 150) {
    status = 'draw'
    drawReason = 'seventy-five-move'
  }
  if (status === 'active') {
    if (repetitionCount >= 3) claims.push('threefold-repetition')
    if (halfMoves >= 100) claims.push('fifty-move')
  }
  return Object.freeze({
    fen,
    pieces: Object.freeze([...pieces]),
    turn: engine.turn(),
    check: engine.inCheck(),
    status,
    winner,
    drawReason,
    drawClaims: Object.freeze(claims),
    repetitionKey,
    repetitionCount,
  })
}

export function createChessGame(fen = CHESS_START_FEN): ChessGame {
  const engine = initialEngine(fen)
  const pieces = engine.board().flatMap((row) =>
    row.flatMap((piece) =>
      piece
        ? [
            Object.freeze({
              id:
                (Number(piece.square[1]) - 1) * 8 +
                piece.square.charCodeAt(0) -
                96,
              color: piece.color,
              role: roles[piece.type],
              square: piece.square,
            }),
          ]
        : [],
    ),
  )
  pieces.sort((a, b) => a.id - b.id)
  const initial = position(engine, pieces, [])
  return Object.freeze({
    initialFen: initial.fen,
    position: initial,
    history: Object.freeze([]),
  })
}

function kind(move: Move): ChessMoveKind {
  if (move.isPromotion()) return 'promotion'
  if (move.isEnPassant()) return 'en-passant'
  if (move.isKingsideCastle() || move.isQueensideCastle()) return 'castle'
  return move.isCapture() ? 'capture' : 'move'
}

function describe(move: Move, pieces: readonly ChessPiece[]): ChessLegalMove {
  const actor = pieces.find((piece) => piece.square === move.from)!
  const captureSquare = move.isEnPassant()
    ? (`${move.to[0]}${move.from[1]}` as ChessSquare)
    : move.isCapture()
      ? move.to
      : undefined
  return Object.freeze({
    from: move.from,
    to: move.to,
    pieceId: actor.id,
    san: move.san,
    lan: move.lan,
    kind: kind(move),
    captureSquare,
    promotion: move.promotion
      ? (roles[move.promotion] as ChessPromotion)
      : undefined,
  })
}

export function legalChessMoves(
  game: ChessGame,
  from?: ChessSquare,
): readonly ChessLegalMove[] {
  if (from !== undefined) square(from)
  if (game.position.status !== 'active') return Object.freeze([])
  const engine = new Chess(game.position.fen)
  return Object.freeze(
    engine
      .moves({ verbose: true, square: from })
      .map((move) => describe(move, game.position.pieces)),
  )
}

export function applyChessMove(
  game: ChessGame,
  input: ChessMoveInput,
): Readonly<{ game: ChessGame; receipt: ChessMoveReceipt }> {
  if (game.position.status !== 'active')
    throw new Error('This game has ended. Undo a move or start another game.')
  if (game.history.length >= CHESS_MAX_PLIES)
    throw new Error('This game has reached the 2,000-move-step limit.')
  square(input.from)
  square(input.to)
  const engine = new Chess(game.position.fen)
  const candidates = engine
    .moves({ verbose: true, square: input.from })
    .filter((move) => move.to === input.to)
  if (
    input.promotion === undefined &&
    candidates.some((move) => move.isPromotion())
  )
    throw new Error('Choose a queen, rook, bishop or knight for promotion.')
  const candidate = candidates.find(
    (move) =>
      (move.promotion ? roles[move.promotion] : undefined) === input.promotion,
  )
  if (!candidate) throw new Error('That move is not legal in this position.')
  const move = engine.move({
    from: input.from,
    to: input.to,
    promotion: input.promotion ? promotions[input.promotion] : undefined,
  })
  const described = describe(move, game.position.pieces)
  const captured = described.captureSquare
    ? game.position.pieces.find(
        (piece) => piece.square === described.captureSquare,
      )
    : undefined
  let secondaryMove: ChessMoveReceipt['secondaryMove']
  if (described.kind === 'castle') {
    const rank = input.from[1]!
    const from = `${move.isKingsideCastle() ? 'h' : 'a'}${rank}` as ChessSquare
    const to = `${move.isKingsideCastle() ? 'f' : 'd'}${rank}` as ChessSquare
    const rook = game.position.pieces.find((piece) => piece.square === from)!
    secondaryMove = Object.freeze({ pieceId: rook.id, from, to })
  }
  const pieces = game.position.pieces
    .filter((piece) => piece.id !== captured?.id)
    .map((piece) => {
      if (piece.id === described.pieceId)
        return Object.freeze({
          ...piece,
          square: input.to,
          role: input.promotion ?? piece.role,
        })
      if (piece.id === secondaryMove?.pieceId)
        return Object.freeze({ ...piece, square: secondaryMove.to })
      return piece
    })
  // Count the current before-position once in addition to the previous history.
  const doubleStepTarget = move.isBigPawn()
    ? (`${move.from[0]}${(Number(move.from[1]) + Number(move.to[1])) / 2}` as ChessSquare)
    : undefined
  const after = position(
    engine,
    pieces,
    [...game.history, { before: game.position }],
    doubleStepTarget,
  )
  const receipt: ChessMoveReceipt = Object.freeze({
    ...described,
    ply: game.history.length + 1,
    before: game.position,
    after,
    captured,
    secondaryMove,
  })
  const next: ChessGame = Object.freeze({
    initialFen: game.initialFen,
    position: after,
    history: Object.freeze([...game.history, receipt]),
  })
  return Object.freeze({ game: next, receipt })
}

export function chessPositionAt(game: ChessGame, ply: number): ChessPosition {
  if (!Number.isInteger(ply) || ply < 0 || ply > game.history.length)
    throw new RangeError('Choose a move step in this game.')
  if (ply === game.history.length) return game.position
  return game.history[ply]!.before
}

/** Seeking returns an independent branch; retain the original game to step its full mainline. */
export function seekChessGame(game: ChessGame, ply: number): ChessGame {
  const current = chessPositionAt(game, ply)
  if (ply === game.history.length) return game
  return Object.freeze({
    initialFen: game.initialFen,
    position: current,
    history: Object.freeze(game.history.slice(0, ply)),
  })
}

export function undoChessMove(game: ChessGame): ChessGame {
  if (game.history.length) return seekChessGame(game, game.history.length - 1)
  return game.claimedDraw ? createChessGame(game.initialFen) : game
}

/** Claims apply to the current position; anticipated-move claims are not inferred. */
export function claimChessDraw(
  game: ChessGame,
  reason: ChessDrawClaim,
): ChessGame {
  if (
    game.position.status !== 'active' ||
    !game.position.drawClaims.includes(reason)
  )
    throw new Error('That draw cannot be claimed in this position.')
  return Object.freeze({
    ...game,
    claimedDraw: reason,
    position: Object.freeze({
      ...game.position,
      status: 'draw',
      drawReason: reason,
      drawClaims: Object.freeze([]),
    }),
  })
}
