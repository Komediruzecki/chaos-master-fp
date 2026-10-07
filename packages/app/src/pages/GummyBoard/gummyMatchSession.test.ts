/** Session recovery and cinema handoff preserve the actual legal pre-capture position. */
import { applyChessMove, createChessGame, importChessPgn, } from '@chaos-master/core/chess/chessGame'
import { describe, expect, it } from 'vitest'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
import { createGummyMatchCinemaRecipe, GUMMY_MATCH_CINEMA_KEY, GUMMY_MATCH_SESSION_KEY, gummyMatchCinemaReason, loadGummyMatchSession, readGummyMatchCinemaRecipe, saveGummyMatchCinemaRecipe, saveGummyMatchSession, } from './gummyMatchSession'

function storage() {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
  }
}

const options = {
  settings: GUMMY_BUILTIN_PRESETS[3]!.preset.settings,
  quality: 'tablet' as const,
  scale: 0.9,
  theme: 'glass' as const,
}

describe('gummy match session', () => {
  it('preserves a valid game while rejecting corrupted board settings', () => {
    const store = storage()
    store.setItem(
      GUMMY_MATCH_SESSION_KEY,
      JSON.stringify({
        version: 1,
        pgn: '1. e4 *',
        cursor: 1,
        appearance: { theme: 'unknown', scale: -1 },
      }),
    )
    const restored = loadGummyMatchSession(store)
    expect(restored.session?.game.history[0]?.san).toBe('e4')
    expect(restored.session?.appearance).toBeUndefined()
    expect(restored.error).toContain('board settings were invalid')
  })

  it('reports a missing or corrupted match shot instead of silently choosing a different capture', () => {
    const store = storage()
    expect(readGummyMatchCinemaRecipe(store).error).toContain(
      'could not be opened',
    )
    store.setItem(GUMMY_MATCH_CINEMA_KEY, '{broken')
    expect(readGummyMatchCinemaRecipe(store).error).toContain(
      'could not be opened',
    )
  })

  it('restores the entire mainline and review cursor without truncating later moves', () => {
    const store = storage()
    const imported = importChessPgn(
      '[Event "Local test"]\n\n1. e4 d5 2. exd5 *',
    )
    saveGummyMatchSession({ ...imported, cursor: 1 }, store)
    const restored = loadGummyMatchSession(store)
    expect(restored.error).toBeUndefined()
    expect(restored.session?.cursor).toBe(1)
    expect(restored.session?.game.history.map((move) => move.san)).toEqual([
      'e4',
      'd5',
      'exd5',
    ])
    expect(restored.session?.game.position.fen).toBe(imported.game.position.fen)
    expect(restored.session?.headers.Event).toBe('Local test')
  })

  it.each([-1, 4, 0.5, '1'])(
    'rejects invalid review cursor %s without changing stored data',
    (cursor) => {
      const store = storage()
      const value = JSON.stringify({
        version: 1,
        pgn: '1. e4 d5 2. exd5 *',
        cursor,
      })
      store.setItem(GUMMY_MATCH_SESSION_KEY, value)
      expect(loadGummyMatchSession(store).session).toBeUndefined()
      expect(store.getItem(GUMMY_MATCH_SESSION_KEY)).toBe(value)
    },
  )

  it('rejects an illegal saved game rather than restoring a partial position', () => {
    const store = storage()
    store.setItem(
      GUMMY_MATCH_SESSION_KEY,
      JSON.stringify({ version: 1, pgn: '1. e5 *', cursor: 0 }),
    )
    expect(loadGummyMatchSession(store)).toEqual({
      error: 'The saved match could not be restored. A new board is ready.',
    })
  })

  it('sends the before position and chosen material to Cinema and retains the handoff for reloads', () => {
    const store = storage()
    const receipt = importChessPgn('1. e4 d5 2. exd5 *').game.history[2]!
    const recipe = createGummyMatchCinemaRecipe(receipt, options)
    expect(recipe.shot.fen).toBe(receipt.before.fen)
    expect(recipe.shot.fen).not.toBe(receipt.after.fen)
    expect(recipe.shot.from).toBe('e4')
    expect(recipe.shot.to).toBe('d5')
    expect(recipe.shot.title).toBe('Pawn takes pawn')
    expect(recipe.material).toEqual(options.settings)
    expect(recipe.quality).toBe('tablet')
    expect(recipe.shot.boardTheme).toBe('glass')
    expect(recipe.attackerPalette).toBe('marble')
    expect(recipe.victimPalette).toBe('blue')
    saveGummyMatchCinemaRecipe(recipe, store)
    expect(readGummyMatchCinemaRecipe(store).recipe).toEqual(recipe)
    expect(store.getItem(GUMMY_MATCH_CINEMA_KEY)).not.toBeNull()
    expect(readGummyMatchCinemaRecipe(store).recipe).toEqual(recipe)
  })

  it('explains unsupported shots while preserving legal en-passant and promotion captures', () => {
    const enPassant = importChessPgn('1. e4 a6 2. e5 d5 3. exd6 *').game
      .history[4]!
    expect(gummyMatchCinemaReason(enPassant)).toContain('En-passant')
    expect(() => createGummyMatchCinemaRecipe(enPassant, options)).toThrow(
      'En-passant',
    )
    const promotion = applyChessMove(
      createChessGame('1r5k/P7/8/8/8/8/8/7K w - - 0 1'),
      { from: 'a7', to: 'b8', promotion: 'queen' },
    ).receipt
    expect(gummyMatchCinemaReason(promotion)).toContain('Promotion')
    expect(() => createGummyMatchCinemaRecipe(promotion, options)).toThrow(
      'Promotion',
    )
    expect(
      gummyMatchCinemaReason(importChessPgn('1. e4 *').game.history[0]),
    ).toContain('no capture')
  })

  it('reports blocked storage without substituting a different shot', () => {
    const store = {
      ...storage(),
      getItem() {
        throw new Error('Storage blocked')
      },
    }
    expect(readGummyMatchCinemaRecipe(store).recipe).toBeUndefined()
    expect(readGummyMatchCinemaRecipe(store).error).toContain(
      'could not be opened',
    )
  })
})
