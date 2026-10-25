/** Native collection snapshots survive session recovery without changing older gummy matches. */
import { importChessPgn } from '@chaos-master/core/chess/chessGame'
import { describe, expect, it } from 'vitest'
import { FRACTAL_CHESS_COLLECTIONS } from '@/flame/chess/fractalChessCollections'
import { defaultGummyMatchAppearance, validateGummyMatchAppearance, validateNativeChessCollectionSelection, } from './gummyMatchAppearance'
import { GUMMY_MATCH_SESSION_KEY, loadGummyMatchSession, saveGummyMatchSession, } from './gummyMatchSession'
import type { NativeChessCollectionSelection } from './gummyMatchAppearance'

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

describe('native chess appearance snapshots', () => {
  it('retains gummy defaults when a collection selection is absent', () => {
    expect(validateNativeChessCollectionSelection(undefined)).toBeUndefined()
    const original = defaultGummyMatchAppearance()
    expect(validateGummyMatchAppearance(original)).toEqual(original)
    expect(original.nativeCollection).toBeUndefined()
  })

  it.each(FRACTAL_CHESS_COLLECTIONS.map((collection) => collection.id))(
    'validates both presentations of %s and copies their settings',
    (id) => {
      for (const enclosure of ['pure', 'glass'] as const) {
        const nativeCollection: NativeChessCollectionSelection = {
          version: 1,
          id,
          enclosure,
        }
        const original = { ...defaultGummyMatchAppearance(), nativeCollection }
        const snapshot = validateGummyMatchAppearance(original)
        expect(snapshot.nativeCollection).toEqual(nativeCollection)
        expect(snapshot.nativeCollection).not.toBe(nativeCollection)
        expect(snapshot.settings).not.toBe(original.settings)
        expect(snapshot.settings.tuning).not.toBe(original.settings.tuning)
        original.nativeCollection.enclosure =
          enclosure === 'pure' ? 'glass' : 'pure'
        original.settings.tuning.gravity = 0
        expect(snapshot.nativeCollection!.enclosure).toBe(enclosure)
        expect(snapshot.settings.tuning.gravity).toBe(1)
      }
    },
  )

  it.each([
    null,
    [],
    'wild-canopy',
    {},
    { version: 2, id: 'wild-canopy', enclosure: 'pure' },
    { version: '1', id: 'wild-canopy', enclosure: 'pure' },
    { version: 1, id: 'unknown', enclosure: 'pure' },
    { version: 1, id: 'wild-canopy', enclosure: 'both' },
    { version: 1, id: 'wild-canopy', enclosure: 'pure', shader: 'arbitrary' },
  ])('rejects malformed native selection %j', (nativeCollection) => {
    expect(() =>
      validateGummyMatchAppearance({
        ...defaultGummyMatchAppearance(),
        nativeCollection,
      }),
    ).toThrow('Invalid native chess collection')
  })

  it('persists the selected set and glass mode alongside a full game and review cursor', () => {
    const store = storage()
    const imported = importChessPgn('1. e4 d5 2. exd5 *')
    const appearance = {
      ...defaultGummyMatchAppearance(),
      nativeCollection: {
        version: 1,
        id: 'tidal-relics',
        enclosure: 'glass',
      } as const,
    }
    saveGummyMatchSession({ ...imported, cursor: 1, appearance }, store)
    const restored = loadGummyMatchSession(store)
    expect(restored.error).toBeUndefined()
    expect(restored.session!.appearance).toEqual(appearance)
    expect(restored.session!.cursor).toBe(1)
    expect(restored.session!.game.history.map((move) => move.san)).toEqual([
      'e4',
      'd5',
      'exd5',
    ])
    expect(restored.session!.captures![0]!.appearance.nativeCollection).toEqual(
      appearance.nativeCollection,
    )
  })

  it.each([1, 2])(
    'restores a legacy v%s gummy appearance without inventing a native set',
    (version) => {
      const store = storage()
      store.setItem(
        GUMMY_MATCH_SESSION_KEY,
        JSON.stringify({
          version,
          pgn: '1. e4 *',
          cursor: 1,
          appearance: defaultGummyMatchAppearance(),
          ...(version === 2 ? { captures: [] } : {}),
        }),
      )
      const restored = loadGummyMatchSession(store)
      expect(restored.error).toBeUndefined()
      expect(restored.session!.appearance!.nativeCollection).toBeUndefined()
      expect(restored.session!.game.history[0]!.san).toBe('e4')
    },
  )

  it('recovers legal moves from an invalid collection without modifying stored data', () => {
    const store = storage()
    const value = JSON.stringify({
      version: 2,
      pgn: '1. e4 *',
      cursor: 1,
      captures: [],
      appearance: {
        ...defaultGummyMatchAppearance(),
        nativeCollection: {
          version: 1,
          id: 'removed-collection',
          enclosure: 'glass',
        },
      },
    })
    store.setItem(GUMMY_MATCH_SESSION_KEY, value)
    const restored = loadGummyMatchSession(store)
    expect(restored.session!.game.history[0]!.san).toBe('e4')
    expect(restored.session!.appearance).toBeUndefined()
    expect(restored.error).toContain('board settings were invalid')
    expect(store.getItem(GUMMY_MATCH_SESSION_KEY)).toBe(value)
  })
})
