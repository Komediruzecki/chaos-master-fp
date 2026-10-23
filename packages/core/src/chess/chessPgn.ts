/** Bounded single-game PGN mainline import and export through the same legal move receipts. */
import { Chess } from 'chess.js'
import { applyChessMove, CHESS_MAX_PLIES, claimChessDraw, createChessGame, } from './chessRules'
import type { ChessGame, ChessPgnImport, ChessPromotion } from './chessTypes'

export const CHESS_MAX_PGN_LENGTH = 100_000
const claimHeader = 'LumenDrawClaim'
const canonicalHeaders: Readonly<Record<string, string>> = {
  event: 'Event',
  site: 'Site',
  date: 'Date',
  round: 'Round',
  white: 'White',
  black: 'Black',
  result: 'Result',
  setup: 'SetUp',
  fen: 'FEN',
  variant: 'Variant',
  lumendrawclaim: claimHeader,
}
const headerName = (key: string) =>
  Object.hasOwn(canonicalHeaders, key.toLowerCase())
    ? canonicalHeaders[key.toLowerCase()]!
    : key
const hasControlCharacters = (value: string) =>
  Array.from(value).some((character) => character.charCodeAt(0) < 32)
const promotionRoles: Readonly<Record<string, ChessPromotion>> = {
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
}

/** chess.js 1.4 cannot parse escaped quotes in tag values. Read only that
 * metadata boundary here; all move text, comments and variations stay with it. */
function headerSection(text: string) {
  const headers: Record<string, string> = {}
  const names = new Set<string>()
  const tag =
    /\s*\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\["\\]|[^"\\\r\n])*)"\s*\]/y
  let offset = 0
  for (;;) {
    tag.lastIndex = offset
    const match = tag.exec(text)
    if (!match) break
    const key = match[1]!,
      value = match[2]!.replace(/\\(["\\])/g, '$1')
    if (names.has(key.toLowerCase()))
      throw new Error('Each PGN header must have a unique name.')
    if (
      names.size >= 64 ||
      key.length > 80 ||
      value.length > 2000 ||
      hasControlCharacters(value)
    )
      throw new Error(
        'A PGN header exceeds the supported size or contains control characters.',
      )
    names.add(key.toLowerCase())
    headers[headerName(key)] = value
    offset = tag.lastIndex
  }
  return { headers, body: text.slice(offset) }
}

function initialFenHeader(headers: Readonly<Record<string, string>>) {
  const header = (name: string) =>
    Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
  const fen = header('fen')
  const setupTag = header('setup')
  if (setupTag !== undefined && setupTag !== '0' && setupTag !== '1')
    throw new Error('Use 0 or 1 for the PGN SetUp header.')
  if ((setupTag === '1' && !fen) || (setupTag === '0' && fen))
    throw new Error('The PGN SetUp and FEN headers disagree.')
  return fen
}

export function importChessPgn(text: string): ChessPgnImport {
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > CHESS_MAX_PGN_LENGTH
  )
    throw new Error('Paste one PGN game of at most 100,000 characters.')
  const section = headerSection(text)
  const fen = initialFenHeader(section.headers)
  let game = createChessGame(fen)
  const source = new Chess()
  const setup = fen ? `[SetUp "1"]\n[FEN "${game.initialFen}"]\n\n` : ''
  source.loadPgn(setup + section.body)
  const headers = { ...source.getHeaders(), ...section.headers }
  const variant = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === 'variant',
  )?.[1]
  if (variant && !/^(?:standard|chess)$/i.test(variant))
    throw new Error('Only standard chess PGN games are supported.')
  const moves = source.history({ verbose: true })
  if (moves.length > CHESS_MAX_PLIES)
    throw new Error('Import a PGN with at most 2,000 move steps.')
  for (const move of moves) {
    game = applyChessMove(game, {
      from: move.from,
      to: move.to,
      promotion: move.promotion ? promotionRoles[move.promotion] : undefined,
    }).game
  }
  if (headers[claimHeader] !== undefined) {
    const claim = headers[claimHeader]
    if (
      (claim !== 'threefold-repetition' && claim !== 'fifty-move') ||
      headers.Result !== '1/2-1/2'
    )
      throw new Error('The saved PGN draw claim is invalid.')
    game = claimChessDraw(game, claim)
  }
  return Object.freeze({ game, headers: Object.freeze({ ...headers }) })
}

/** Only game state controls setup/result/claim tags, so headers from another line cannot override them. */
export function exportChessPgn(
  game: ChessGame,
  headers: Readonly<Record<string, string>> = {},
): string {
  const engine = new Chess(game.initialFen)
  if (Object.keys(headers).length > 64)
    throw new Error('Use at most 64 PGN headers.')
  const names = new Set<string>()
  for (const [key, value] of Object.entries(headers)) {
    if (names.has(key.toLowerCase()))
      throw new Error('Each PGN header must have a unique name.')
    names.add(key.toLowerCase())
    if (
      ['fen', 'setup', 'result', 'lumendrawclaim'].includes(key.toLowerCase())
    )
      continue
    if (
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) ||
      key.length > 80 ||
      typeof value !== 'string' ||
      value.length > 2000 ||
      hasControlCharacters(value)
    )
      throw new Error('A PGN header contains an invalid name or value.')
    // chess.js does not escape tag values when writing them.
    engine.setHeader(
      headerName(key),
      value.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
    )
  }
  for (const move of game.history)
    engine.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion
        ? ({ queen: 'q', rook: 'r', bishop: 'b', knight: 'n' } as const)[
            move.promotion
          ]
        : undefined,
    })
  engine.setHeader(
    'Result',
    game.position.status === 'checkmate'
      ? game.position.winner === 'w'
        ? '1-0'
        : '0-1'
      : game.position.status === 'draw' || game.position.status === 'stalemate'
        ? '1/2-1/2'
        : '*',
  )
  if (game.claimedDraw) engine.setHeader(claimHeader, game.claimedDraw)
  if (Object.keys(engine.getHeaders()).length > 64)
    throw new Error(
      'Use at most 64 PGN headers, including the standard game headers.',
    )
  const result = engine.pgn()
  if (result.length > CHESS_MAX_PGN_LENGTH)
    throw new Error('This PGN exceeds the 100,000-character import limit.')
  return result
}
