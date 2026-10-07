/** Capture fixtures cover each move family, blocked rays and king safety independently of rendering. */
import { describe, expect, it } from 'vitest'
import { gummyBoardSquare, parseGummyBoardFen, validateGummyBoardCapture, } from './gummyBoardPosition'

describe('cinematic chess positions', () => {
  it('decodes standard FEN with stable square IDs and board orientation', () => {
    const position = parseGummyBoardFen(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    )
    expect(position.pieces).toHaveLength(32)
    expect(position.sideToMove).toBe(0)
    expect(position.pieces.find((p) => p.square === 'a1')).toMatchObject({
      id: 1,
      mould: 'rook',
      side: 0,
    })
    expect(position.pieces.find((p) => p.square === 'h8')).toMatchObject({
      id: 64,
      mould: 'rook',
      side: 1,
    })
    expect(gummyBoardSquare('e4').position).toEqual([0.8, 0, 0.8])
    expect(gummyBoardSquare('d5').position).toEqual([-0.8, 0, -0.8])
    expect(position.pieces.find((p) => p.square === 'b1')!.rotationY).toBe(
      Math.PI / 2,
    )
    expect(position.pieces.find((p) => p.square === 'b8')!.rotationY).toBe(
      -Math.PI / 2,
    )
  })

  it.each([
    ['pawn', '7k/8/8/3n4/4P3/8/8/K7 w - - 0 1', 'e4', 'd5'],
    ['knight', '7k/8/8/3r4/8/2N5/8/K7 w - - 0 1', 'c3', 'd5'],
    ['bishop', '7k/8/5r2/8/3B4/8/8/K7 w - - 0 1', 'd4', 'f6'],
    ['rook', '7k/8/8/3r4/8/8/3R4/K7 w - - 0 1', 'd2', 'd5'],
    ['queen', '7k/8/8/5r2/8/3Q4/8/K7 w - - 0 1', 'd3', 'f5'],
    ['king', '7k/8/8/8/3r4/2K5/8/8 w - - 0 1', 'c3', 'd4'],
    ['pawn', '7k/8/3p4/4N3/8/8/8/K7 b - - 0 1', 'd6', 'e5'],
  ])('accepts a legal %s capture', (mould, fen, from, to) => {
    const position = parseGummyBoardFen(fen)
    const before = JSON.stringify(position)
    const { attacker, victim } = validateGummyBoardCapture(position, from, to)
    expect(attacker.mould).toBe(mould)
    expect(attacker.side).not.toBe(victim.side)
    expect(JSON.stringify(position)).toBe(before)
  })

  it.each([
    ['7k/8/5r2/4P3/3B4/8/8/K7 w - - 0 1', 'd4', 'f6', /blocked/],
    ['k3r3/8/8/8/8/5r2/4B3/4K3 w - - 0 1', 'e2', 'f3', /king in check/],
    ['7k/6b1/8/8/3p4/2K5/8/8 w - - 0 1', 'c3', 'd4', /king in check/],
    ['7k/8/8/3n4/4P3/8/8/K7 w - - 0 1', 'd5', 'e4', /side to move/],
    ['7k/8/8/3n4/4P3/8/8/K7 w - - 0 1', 'e4', 'e5', /occupied destination/],
    ['7k/8/8/3n4/4P3/8/8/K7 w - - 0 1', 'e4', 'd4', /occupied destination/],
    ['r6k/1P6/8/8/8/8/8/K7 w - - 0 1', 'b7', 'a8', /Promotion/],
  ] as const)(
    'rejects unsupported or unsafe %s %s-%s',
    (fen, from, to, error) => {
      expect(() =>
        validateGummyBoardCapture(parseGummyBoardFen(fen), from, to),
      ).toThrow(error)
    },
  )

  it.each([
    '8/8/8/8/8/8/8/8 w - - 0 1',
    '7k/7K/8/8/8/8/8/8 w - - 0 1',
    '7k/8/8/8/8/8/8/K6P w - - 0 1',
    '7k/8/8/8/8/8/8/K7 w K - 0 1',
    '7k/8/8/8/8/8/8/K7 w - e6 0 1',
    '7k/8/8/8/8/8/8/K7 w - - -1 1',
    '7k/8/8/8/8/8/8/K7 w - - 0 0',
    '7k/8/8/8/8/8/8/K7 x - - 0 1',
    '7k/8/8/8/8/8/8/K8 w - - 0 1',
    '7k/8/8/8/8/8/8/K7',
  ])('rejects invalid FEN %s', (fen) => {
    expect(() => parseGummyBoardFen(fen)).toThrow()
  })

  it('accepts an en-passant FEN but scopes shots to occupied-square captures', () => {
    const position = parseGummyBoardFen('7k/8/8/3pP3/8/8/8/K7 w - d6 0 1')
    expect(() => validateGummyBoardCapture(position, 'e5', 'd6')).toThrow(
      /En-passant/,
    )
    for (const square of ['a0', 'i1', 'a9', 'E4', 'e44', ''])
      expect(() => gummyBoardSquare(square)).toThrow()
  })
})
