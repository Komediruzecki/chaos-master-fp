/** Native Cinema storage preserves reloads without consuming or overwriting other capture state. */
import { importChessPgn } from '@chaos-master/core/chess/chessGame'
import { describe, expect, it } from 'vitest'
import { createNativeCinemaRecipe } from './nativeCinemaRecipe'
import { NATIVE_CINEMA_KEY, readNativeCinemaRecipe, saveNativeCinemaRecipe, } from './nativeCinemaSession'

function storage() {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem(key: string, value: string) {
      entries.set(key, value)
    },
  }
}
const recipe = () =>
  createNativeCinemaRecipe(
    importChessPgn('1. e4 d5 2. exd5 *').game.history[2]!,
    {
      nativeCollection: { version: 1, id: 'tidal-relics', enclosure: 'pure' },
      scale: 0.95,
    },
  )

describe('native Cinema handoff', () => {
  it('keeps a validated shot available after repeated reads without touching other data', () => {
    const store = storage()
    store.setItem('gummy-match-cinema-v1', 'existing gummy shot')
    store.setItem('gummy-match-session-v1', 'existing match')
    const shot = recipe()
    saveNativeCinemaRecipe(shot, store)
    expect(readNativeCinemaRecipe(store)).toEqual({ recipe: shot })
    expect(readNativeCinemaRecipe(store)).toEqual({ recipe: shot })
    expect(store.getItem('gummy-match-cinema-v1')).toBe('existing gummy shot')
    expect(store.getItem('gummy-match-session-v1')).toBe('existing match')
  })
  it.each([undefined, '{broken', '{}', ' '.repeat(30_001)])(
    'reports a missing, corrupt or oversized handoff without replacing it',
    (raw) => {
      const store = storage()
      if (raw !== undefined) store.setItem(NATIVE_CINEMA_KEY, raw)
      const result = readNativeCinemaRecipe(store)
      expect(result.recipe).toBeUndefined()
      expect(result.error).toContain('Return to the match')
      expect(store.getItem(NATIVE_CINEMA_KEY)).toBe(raw ?? null)
    },
  )
  it('rejects invalid writes before replacing the last valid shot', () => {
    const store = storage()
    const shot = recipe()
    saveNativeCinemaRecipe(shot, store)
    expect(() => {
      saveNativeCinemaRecipe({ ...shot, scale: 0 }, store)
    }).toThrow('Piece size')
    expect(readNativeCinemaRecipe(store)).toEqual({ recipe: shot })
  })
  it('reports read failures and propagates write failures for the navigation guard', () => {
    const store = {
      getItem() {
        throw new Error('Blocked storage')
      },
      setItem() {
        throw new Error('Quota exceeded')
      },
    }
    expect(readNativeCinemaRecipe(store).error).toContain('could not be opened')
    expect(() => {
      saveNativeCinemaRecipe(recipe(), store)
    }).toThrow('Quota exceeded')
  })
})
