/** Chess adapter contracts: identity, special-move receipts, history, draw claims and portable PGN. */
import { describe, expect, it } from 'vitest'
import { applyChessMove, chessPositionAt, claimChessDraw, createChessGame, exportChessPgn, importChessPgn, legalChessMoves, seekChessGame, undoChessMove, } from './chessGame'
import type { ChessGame, ChessMoveInput, ChessSquare } from './chessGame'

const play = (game: ChessGame, ...moves: string[]) =>
  moves.reduce(
    (next, lan) =>
      applyChessMove(next, {
        from: lan.slice(0, 2) as ChessSquare,
        to: lan.slice(2, 4) as ChessSquare,
      }).game,
    game,
  )
const at = (game: ChessGame, square: ChessSquare) =>
  game.position.pieces.find((piece) => piece.square === square)
const castleFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'

describe('legal match state and immutable receipts', () => {
  it('starts with legal choices, stable identities and all six FEN fields', () => {
    const game = createChessGame()
    expect(game.position.pieces).toHaveLength(32)
    expect(legalChessMoves(game)).toHaveLength(20)
    expect(legalChessMoves(game, 'e7')).toEqual([])
    const result = applyChessMove(game, { from: 'e2', to: 'e4' })
    expect(at(result.game, 'e4')?.id).toBe(at(game, 'e2')?.id)
    expect(result.game.position.fen.split(' ')).toEqual([
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR',
      'b',
      'KQkq',
      'e3',
      '0',
      '1',
    ])
    expect(result.receipt.before).toBe(game.position)
    expect(result.receipt.after).toBe(result.game.position)
    expect(result.receipt.san).toBe('e4')
    expect(result.receipt.ply).toBe(1)
    expect(game.history).toEqual([])
    expect(at(game, 'e2')?.role).toBe('pawn')
    expect(Object.isFrozen(result.game)).toBe(true)
    expect(Object.isFrozen(result.receipt)).toBe(true)
    expect(Object.isFrozen(at(result.game, 'e4'))).toBe(true)
  })

  it('commits an ordinary capture once and retains its victim snapshot', () => {
    const before = play(createChessGame(), 'e2e4', 'd7d5')
    const attacker = at(before, 'e4')!,
      victim = at(before, 'd5')!
    const { game, receipt } = applyChessMove(before, { from: 'e4', to: 'd5' })
    expect(receipt).toMatchObject({
      kind: 'capture',
      pieceId: attacker.id,
      captureSquare: 'd5',
      captured: victim,
    })
    expect(at(game, 'd5')?.id).toBe(attacker.id)
    expect(game.position.pieces.some((piece) => piece.id === victim.id)).toBe(
      false,
    )
    expect(game.position.turn).toBe('b')
    expect(() => applyChessMove(game, { from: 'e4', to: 'd5' })).toThrow()
    expect(before.position.pieces).toHaveLength(32)
    expect(undoChessMove(game).position).toBe(before.position)
  })

  it('rejects exposing the king and castling through an attacked square', () => {
    const pinned = createChessGame('4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1')
    expect(() => applyChessMove(pinned, { from: 'e2', to: 'd2' })).toThrow()
    const attacked = createChessGame('4kr2/8/8/8/8/8/8/4K2R w K - 0 1')
    expect(
      legalChessMoves(attacked, 'e1').some((move) => move.kind === 'castle'),
    ).toBe(false)
  })

  it('records the actual en-passant victim square and restores it on undo', () => {
    const before = play(createChessGame(), 'e2e4', 'a7a6', 'e4e5', 'd7d5')
    const victim = at(before, 'd5')!
    const { game, receipt } = applyChessMove(before, { from: 'e5', to: 'd6' })
    expect(receipt).toMatchObject({
      kind: 'en-passant',
      from: 'e5',
      to: 'd6',
      captureSquare: 'd5',
      captured: victim,
    })
    expect(at(game, 'd5')).toBeUndefined()
    expect(at(game, 'd6')?.id).toBe(at(before, 'e5')?.id)
    expect(undoChessMove(game).position).toBe(before.position)
    const expired = play(before, 'g1f3', 'g8f6')
    expect(
      legalChessMoves(expired, 'e5').some((move) => move.kind === 'en-passant'),
    ).toBe(false)
  })

  it('carries both rook and king identities through either castling side', () => {
    const start = createChessGame(castleFen)
    const white = applyChessMove(start, { from: 'e1', to: 'g1' })
    expect(white.receipt.secondaryMove).toEqual({
      pieceId: at(start, 'h1')!.id,
      from: 'h1',
      to: 'f1',
    })
    expect(at(white.game, 'g1')?.id).toBe(at(start, 'e1')?.id)
    expect(at(white.game, 'f1')?.id).toBe(at(start, 'h1')?.id)
    const black = applyChessMove(white.game, { from: 'e8', to: 'c8' })
    expect(black.receipt.secondaryMove).toEqual({
      pieceId: at(start, 'a8')!.id,
      from: 'a8',
      to: 'd8',
    })
    expect(at(black.game, 'c8')?.id).toBe(at(start, 'e8')?.id)
    expect(undoChessMove(undoChessMove(black.game)).position.fen).toBe(
      castleFen,
    )
  })

  it('requires explicit promotion and keeps the pawn identity for capture underpromotion', () => {
    const start = createChessGame('1r5k/P7/8/8/8/8/8/7K w - - 0 1')
    expect(
      legalChessMoves(start, 'a7')
        .filter((move) => move.to === 'b8')
        .map((move) => move.promotion)
        .sort(),
    ).toEqual(['bishop', 'knight', 'queen', 'rook'])
    expect(() => applyChessMove(start, { from: 'a7', to: 'b8' })).toThrow(
      'promotion',
    )
    const result = applyChessMove(start, {
      from: 'a7',
      to: 'b8',
      promotion: 'knight',
    })
    expect(result.receipt).toMatchObject({
      kind: 'promotion',
      promotion: 'knight',
      captured: { role: 'rook', square: 'b8' },
    })
    expect(at(result.game, 'b8')).toMatchObject({
      id: at(start, 'a7')!.id,
      role: 'knight',
    })
    expect(at(undoChessMove(result.game), 'a7')?.role).toBe('pawn')
    expect(() =>
      applyChessMove(createChessGame(), {
        from: 'e2',
        to: 'e4',
        promotion: 'queen',
      }),
    ).toThrow()
  })

  it('seeks without mutation and branches from the requested ply', () => {
    const game = play(createChessGame(), 'e2e4', 'e7e5', 'g1f3')
    expect(chessPositionAt(game, 1)).toBe(game.history[0]!.after)
    const branch = play(seekChessGame(game, 1), 'c7c5')
    expect(branch.history.map((move) => move.san)).toEqual(['e4', 'c5'])
    expect(game.history.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3'])
    expect(at(branch, 'c5')?.id).toBe(at(createChessGame(), 'c7')?.id)
    expect(() => seekChessGame(game, -1)).toThrow()
    expect(() => seekChessGame(game, 1.5)).toThrow()
    expect(() => seekChessGame(game, 4)).toThrow()
  })
})

describe('terminal outcomes and draw claims', () => {
  it('ends checkmate, stalemate and insufficient material without capturing a king', () => {
    const mate = play(createChessGame(), 'f2f3', 'e7e5', 'g2g4', 'd8h4')
    expect(mate.position).toMatchObject({
      status: 'checkmate',
      check: true,
      winner: 'b',
    })
    expect(
      mate.position.pieces.filter((piece) => piece.role === 'king'),
    ).toHaveLength(2)
    expect(legalChessMoves(mate)).toEqual([])
    expect(
      createChessGame('7k/5K2/6Q1/8/8/8/8/8 b - - 0 1').position.status,
    ).toBe('stalemate')
    expect(
      createChessGame('7k/8/8/8/8/8/8/7K w - - 0 1').position.drawReason,
    ).toBe('insufficient-material')
  })

  it('allows threefold claims but keeps play legal until fivefold', () => {
    const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8']
    const twice = play(createChessGame(), ...cycle)
    expect(twice.position.repetitionCount).toBe(2)
    expect(twice.position.drawClaims).toEqual([])
    const three = play(twice, ...cycle)
    expect(three.position).toMatchObject({
      status: 'active',
      repetitionCount: 3,
      drawClaims: ['threefold-repetition'],
    })
    const claimed = claimChessDraw(three, 'threefold-repetition')
    expect(claimed.position).toMatchObject({
      status: 'draw',
      drawReason: 'threefold-repetition',
    })
    expect(three.position.status).toBe('active')
    expect(legalChessMoves(claimed)).toEqual([])
    const five = play(three, ...cycle, ...cycle)
    expect(five.position).toMatchObject({
      status: 'draw',
      repetitionCount: 5,
      drawReason: 'fivefold-repetition',
    })
    expect(() => claimChessDraw(twice, 'threefold-repetition')).toThrow()
    expect(undoChessMove(claimed).position.status).toBe('active')
  })

  it('uses legal en-passant rights for repetition, while preserving complete FEN', () => {
    const game = createChessGame('4r1k1/8/8/3pP3/8/8/8/4K3 w - d6 0 1')
    expect(game.position.fen.split(' ')[3]).toBe('d6')
    expect(game.position.repetitionKey.split(' ')[3]).toBe('-')
    expect(
      legalChessMoves(game, 'e5').some((move) => move.kind === 'en-passant'),
    ).toBe(false)
  })

  it('distinguishes 50-move claims from 75-move draws and gives mate precedence', () => {
    const fifty = createChessGame('7k/8/8/8/8/8/8/R6K w - - 100 51')
    expect(fifty.position).toMatchObject({
      status: 'active',
      drawClaims: ['fifty-move'],
    })
    expect(claimChessDraw(fifty, 'fifty-move').position.drawReason).toBe(
      'fifty-move',
    )
    const threshold = createChessGame('7k/8/8/8/8/8/8/R6K w - - 149 100')
    expect(play(threshold, 'a1a2').position.drawReason).toBe(
      'seventy-five-move',
    )
    const beforeMate = createChessGame('7k/5K2/6Q1/8/8/8/8/8 w - - 149 100')
    expect(play(beforeMate, 'g6g7').position).toMatchObject({
      status: 'checkmate',
      winner: 'w',
    })
  })
})

describe('FEN validation', () => {
  it.each([
    '8/8/8/8/8/8/8/8 w - - 0 1',
    '7k/8/8/8/8/8/8/7K w - - 1x 1',
    '7k/8/8/8/8/8/8/7K w - - 0 1.5',
    '7k/8/8/8/8/8/8/7K w K - 0 1',
    '7k/8/8/8/8/8/8/7K w - d6 0 1',
    '7k/7K/8/8/8/8/8/8 w - - 0 1',
    '7k/8/8/8/8/8/8/R6K w - - 0',
    ' '.repeat(257),
  ])('rejects invalid or inconsistent initial state: %s', (fen) => {
    expect(() => createChessGame(fen)).toThrow()
  })
})

describe('PGN mainline and portable match state', () => {
  it('imports the mainline through comments/variations and preserves identity while stepping', () => {
    const imported = importChessPgn(
      '[Event "Fixture"]\n\n1. e4 {a comment} (1. d4 d5) e5 2. Nf3 Nc6 *',
    )
    expect(imported.headers.Event).toBe('Fixture')
    expect(imported.game.history.map((move) => move.san)).toEqual([
      'e4',
      'e5',
      'Nf3',
      'Nc6',
    ])
    expect(at(seekChessGame(imported.game, 0), 'g1')?.id).toBe(
      at(imported.game, 'f3')?.id,
    )
    expect(
      importChessPgn(exportChessPgn(imported.game, imported.headers)).game,
    ).toEqual(imported.game)
  })

  it('round-trips setup FEN, castling, en passant and promotion captures', () => {
    const games = [
      play(createChessGame(castleFen), 'e1g1', 'e8c8'),
      play(createChessGame(), 'e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'),
      applyChessMove(createChessGame('1r5k/P7/8/8/8/8/8/7K w - - 0 1'), {
        from: 'a7',
        to: 'b8',
        promotion: 'rook',
      }).game,
    ]
    for (const game of games)
      expect(importChessPgn(exportChessPgn(game)).game).toEqual(game)
  })

  it('preserves a validated claimed draw across export/import', () => {
    const game = claimChessDraw(
      createChessGame('7k/8/8/8/8/8/8/R6K w - - 100 51'),
      'fifty-move',
    )
    const text = exportChessPgn(game)
    expect(text).toContain('[LumenDrawClaim "fifty-move"]')
    expect(importChessPgn(text).game).toEqual(game)
    expect(() =>
      importChessPgn(
        '[LumenDrawClaim "fifty-move"]\n[Result "1/2-1/2"]\n\n1. e4 1/2-1/2',
      ),
    ).toThrow()
  })

  it('keeps setup and result authoritative when exporting a branched game', () => {
    const game = play(createChessGame(), 'e2e4')
    const imported = importChessPgn(
      exportChessPgn(game, {
        FEN: 'invalid',
        SetUp: '1',
        Result: '1-0',
        LumenDrawClaim: 'fifty-move',
      }),
    )
    expect(imported.game).toEqual(game)
    expect(imported.headers.Result).toBe('*')
    expect(imported.headers.LumenDrawClaim).toBeUndefined()
  })

  it('normalizes standard header spelling and rejects export header collisions', () => {
    const imported = importChessPgn('[event "Fixture"]\n\n1. e4 *')
    expect(imported.headers.Event).toBe('Fixture')
    expect(
      importChessPgn(exportChessPgn(imported.game, imported.headers)).headers
        .Event,
    ).toBe('Fixture')
    expect(() =>
      exportChessPgn(createChessGame(), { Event: 'One', event: 'Two' }),
    ).toThrow('unique')
    const many = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`Fixture${index}`, 'value']),
    )
    expect(() => exportChessPgn(createChessGame(), many)).toThrow('64')
  })

  it('round-trips escaped header values', () => {
    const headers = {
      Event: 'Fixture "quoted" \\ value',
      constructor: 'Fixture',
    }
    expect(
      importChessPgn(exportChessPgn(createChessGame(), headers)).headers.Event,
    ).toBe(headers.Event)
  })

  it.each([
    '',
    'x'.repeat(100_001),
    '1. e5 *',
    '1. -- *',
    '[Variant "Chess960"]\n\n1. e4 *',
    '[SetUp "1"]\n\n1. e4 *',
    '[SetUp "2"]\n\n1. e4 *',
    '[Event "one"]\n[event "two"]\n\n1. e4 *',
    `[SetUp "0"]\n[FEN "${castleFen}"]\n\n*`,
  ])('rejects malformed, oversized or unsupported imports', (pgn) => {
    expect(() => importChessPgn(pgn)).toThrow()
  })

  it('does not accept bogus promotion input', () => {
    expect(() =>
      applyChessMove(createChessGame(), {
        from: 'e2',
        to: 'e4',
        promotion: 'king',
      } as unknown as ChessMoveInput),
    ).toThrow()
  })
})
