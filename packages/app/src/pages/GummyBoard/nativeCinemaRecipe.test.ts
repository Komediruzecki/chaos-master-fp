/** Native shot recipes retain legal special captures and reject fabricated positions and appearances. */
import { applyChessMove, createChessGame, importChessPgn, } from '@chaos-master/core/chess/chessGame'
import { describe, expect, it } from 'vitest'
import { createNativeCinemaRecipe, nativeCinemaReason, parseNativeCinemaRecipe, resolveNativeCinemaReceipt, } from './nativeCinemaRecipe'

const look = {
  nativeCollection: {
    version: 1 as const,
    id: 'wild-canopy' as const,
    enclosure: 'glass' as const,
  },
  scale: 0.9,
}
const capture = () => importChessPgn('1. e4 d5 2. exd5 *').game.history[2]!

describe('native Cinema recipes', () => {
  it('round-trips the before position, selected collection and legal resulting board', () => {
    const receipt = capture()
    const recipe = createNativeCinemaRecipe(receipt, look)
    const restored = parseNativeCinemaRecipe(JSON.stringify(recipe))
    const move = resolveNativeCinemaReceipt(restored)
    expect(recipe).toMatchObject({
      format: 'native-chess-cinema-shot',
      version: 1,
      fen: receipt.before.fen,
      from: 'e4',
      to: 'd5',
      ...look,
      quality: 'normal',
      camera: 'arc',
    })
    expect(move.after.fen).toBe(receipt.after.fen)
    expect(move.captured).toMatchObject({
      role: 'pawn',
      color: 'b',
      square: 'd5',
    })
    expect(restored).toEqual(recipe)
    expect(recipe.nativeCollection).not.toBe(look.nativeCollection)
  })

  it('rebuilds receipts from the move rather than accepting supplied playback state', () => {
    const recipe = createNativeCinemaRecipe(capture(), look)
    const restored = parseNativeCinemaRecipe({
      ...recipe,
      receipt: { after: { fen: 'fabricated' } },
    })
    expect(restored).toEqual(recipe)
    expect(resolveNativeCinemaReceipt(restored).after.fen).toBe(
      capture().after.fen,
    )
  })

  it('preserves the offset victim for en-passant', () => {
    const receipt = importChessPgn('1. e4 a6 2. e5 d5 3. exd6 *').game
      .history[4]!
    expect(nativeCinemaReason(receipt)).toBeUndefined()
    const restored = resolveNativeCinemaReceipt(
      createNativeCinemaRecipe(receipt, look),
    )
    expect(restored.kind).toBe('en-passant')
    expect(restored.to).toBe('d6')
    expect(restored.captured?.square).toBe('d5')
    expect(restored.after.fen).toBe(receipt.after.fen)
  })

  it.each(['queen', 'rook', 'bishop', 'knight'] as const)(
    'preserves a capture promotion to %s',
    (promotion) => {
      const { receipt } = applyChessMove(
        createChessGame('1r5k/P7/8/8/8/8/8/7K w - - 0 1'),
        {
          from: 'a7',
          to: 'b8',
          promotion,
        },
      )
      const recipe = createNativeCinemaRecipe(receipt, look)
      const restored = resolveNativeCinemaReceipt(
        parseNativeCinemaRecipe(JSON.stringify(recipe)),
      )
      expect(restored.promotion).toBe(promotion)
      expect(restored.after.fen).toBe(receipt.after.fen)
      expect(
        restored.after.pieces.find((piece) => piece.square === 'b8')?.role,
      ).toBe(promotion)
      expect(() =>
        parseNativeCinemaRecipe({ ...recipe, promotion: undefined }),
      ).toThrow('promotion')
    },
  )

  it.each([
    { from: 'e4', to: 'e5' },
    { from: 'a1', to: 'd5' },
    { fen: capture().after.fen },
    { fen: 'not a chess position' },
    { from: 'a9' },
    { to: 'd5 extra' },
    { promotion: 'king' },
    { version: 2 },
    { format: 'gummy-cinema-shot' },
    { nativeCollection: undefined },
    { nativeCollection: { ...look.nativeCollection, id: 'missing' } },
    { nativeCollection: { ...look.nativeCollection, enclosure: 'opaque' } },
    { quality: 'unbounded' },
    { camera: 'unknown' },
    { scale: Number.NaN },
    { scale: 0.849 },
    { scale: 1.001 },
  ])('rejects an invalid or non-capturing recipe %j', (patch) => {
    expect(() =>
      parseNativeCinemaRecipe({
        ...createNativeCinemaRecipe(capture(), look),
        ...patch,
      }),
    ).toThrow()
  })

  it('requires a capture and bounds JSON before parsing', () => {
    expect(nativeCinemaReason()).toContain('Choose a capture')
    const quiet = importChessPgn('1. e4 *').game.history[0]!
    expect(() => createNativeCinemaRecipe(quiet, look)).toThrow('no capture')
    expect(() => parseNativeCinemaRecipe(' '.repeat(30_001))).toThrow(
      'too large',
    )
    expect(() => parseNativeCinemaRecipe([])).toThrow('recipe object')
  })
})
