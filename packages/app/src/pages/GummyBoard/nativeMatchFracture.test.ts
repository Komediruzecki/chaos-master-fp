/** Capture provenance survives settings changes, legal special moves, migration and Cinema handoff. */
import { applyChessMove, createChessGame, importChessPgn, } from '@chaos-master/core/chess/chessGame'
import { cleanup, renderHook } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultGummyMatchAppearance, validateGummyMatchAppearance, } from './gummyMatchAppearance'
import { createGummyMatchCapturePresentation, parseGummyMatchCaptures, } from './gummyMatchCaptures'
import { GUMMY_MATCH_SESSION_KEY, loadGummyMatchSession, saveGummyMatchSession, } from './gummyMatchSession'
import { createNativeCinemaRecipe } from './nativeCinemaRecipe'
import { nativeMatchCaptureFracture, nativeMatchFractureNotice, } from './nativeMatchFracture'
import { useGummyMatch } from './useGummyMatch'
import type { NativeFractureMode } from '@/flame/chess/nativeFractureTypes'

const nativeCollection = {
  version: 1,
  id: 'lattice-court',
  enclosure: 'pure',
} as const
const fen = 'r6k/8/8/8/8/8/8/R6K w - - 0 1'
const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n1. Rxa8+ *`

function appearance(nativeFracture?: NativeFractureMode) {
  return {
    ...defaultGummyMatchAppearance(),
    nativeCollection,
    ...(nativeFracture ? { nativeFracture } : {}),
  }
}

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
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('native capture breakup provenance', () => {
  it('retains a native promotion capture after switching the current board back to gummy', () => {
    const promotion = applyChessMove(
      createChessGame('1r5k/P7/8/8/8/8/8/7K w - - 0 1'),
      { from: 'a7', to: 'b8', promotion: 'queen' },
    )
    const envelope = createGummyMatchCapturePresentation(
      promotion.receipt,
      appearance('contact'),
    )!
    const store = storage()
    saveGummyMatchSession(
      {
        game: promotion.game,
        cursor: 1,
        headers: {},
        appearance: defaultGummyMatchAppearance(),
        captures: [envelope],
      },
      store,
    )
    const restored = loadGummyMatchSession(store)
    expect(restored.error).toBeUndefined()
    expect(restored.session!.appearance!.nativeCollection).toBeUndefined()
    expect(restored.session!.captures).toEqual([envelope])
  })
  it.each(['points', 'connected', 'contact'] as const)(
    'preserves %s through play, later settings, replay, reload and Cinema',
    (mode) => {
      vi.stubGlobal('sessionStorage', storage())
      const { result: match } = renderHook(useGummyMatch)
      match.updateAppearance(appearance(mode))
      expect(match.importPgn(`[SetUp "1"]\n[FEN "${fen}"]\n\n*`)).toBe(true)
      match.commit({ from: 'a1', to: 'a8' })
      const receipt = match.receipt()!
      const saved = structuredClone(match.activePresentation()!)
      expect(saved.appearance.nativeFracture).toBe(mode)
      match.finishAnimation()
      match.updateAppearance({
        nativeFracture: mode === 'contact' ? 'points' : 'contact',
        nativeCollection: { ...nativeCollection, enclosure: 'glass' },
      })
      match.replay()
      expect(
        nativeMatchCaptureFracture(
          match.receipt(),
          match.activePresentation(),
          'lattice-court',
        ),
      ).toBe(mode)
      expect(match.activePresentation()).toEqual(saved)
      match.finishAnimation()
      const { result: restored } = renderHook(useGummyMatch)
      expect(restored.currentPresentation()).toEqual(saved)
      const recipe = createNativeCinemaRecipe(receipt, {
        nativeCollection: restored.appearance().nativeCollection!,
        scale: restored.appearance().scale,
        fracture: nativeMatchCaptureFracture(
          receipt,
          restored.currentPresentation(),
          'lattice-court',
        ),
      })
      expect(recipe.fracture).toBe(mode)
      expect(recipe.nativeCollection.enclosure).toBe('glass')
      expect(nativeMatchCaptureFracture(receipt, saved, 'wild-canopy')).toBe(
        'points',
      )
      expect(nativeMatchFractureNotice(saved, 'wild-canopy')).toBe(
        mode === 'points'
          ? undefined
          : 'This capture keeps its recorded breakup in Lattice Court. Other collections use point breakup.',
      )
      expect(saved.appearance.nativeFracture).toBe(mode)
    },
  )

  it.each([undefined, null, 1, 'melting'])(
    'rejects invalid explicit mode %s without inventing an effect for absent settings',
    (mode) => {
      const value = { ...appearance(), nativeFracture: mode }
      if (mode === undefined)
        expect(
          validateGummyMatchAppearance(value).nativeFracture,
        ).toBeUndefined()
      else
        expect(() => validateGummyMatchAppearance(value)).toThrow(
          'Choose point breakup',
        )
    },
  )

  it.each([1, 2])(
    'keeps recovered v%s historical captures on points even when current settings choose contact',
    (version) => {
      const store = storage()
      store.setItem(
        GUMMY_MATCH_SESSION_KEY,
        JSON.stringify({
          version,
          pgn,
          cursor: 1,
          appearance: appearance('contact'),
          ...(version === 2 ? { captures: [] } : {}),
        }),
      )
      const restored = loadGummyMatchSession(store).session!
      expect(restored.appearance?.nativeFracture).toBe('contact')
      expect(restored.captures).toHaveLength(1)
      expect(
        nativeMatchCaptureFracture(
          restored.game.history[0],
          restored.captures![0],
          'lattice-court',
        ),
      ).toBe('points')
    },
  )

  it('does not add contact to old saved capture envelopes that omitted the mode', () => {
    const game = importChessPgn(pgn).game
    const original = createGummyMatchCapturePresentation(
      game.history[0]!,
      appearance(),
    )!
    const store = storage()
    store.setItem(
      GUMMY_MATCH_SESSION_KEY,
      JSON.stringify({
        version: 2,
        pgn,
        cursor: 1,
        appearance: appearance('contact'),
        captures: [original],
      }),
    )
    const restored = loadGummyMatchSession(store).session!
    expect(restored.captures![0]).toEqual(original)
    expect(
      nativeMatchCaptureFracture(
        game.history[0],
        restored.captures![0],
        'lattice-court',
      ),
    ).toBe('points')
  })

  it('records native promotion and en-passant captures without routing them through gummy shot limitations', () => {
    const promotion = applyChessMove(
      createChessGame('1r5k/P7/8/8/8/8/8/7K w - - 0 1'),
      { from: 'a7', to: 'b8', promotion: 'queen' },
    )
    const envelope = createGummyMatchCapturePresentation(
      promotion.receipt,
      appearance('contact'),
    )!
    expect(parseGummyMatchCaptures([envelope], promotion.game)).toEqual([
      envelope,
    ])
    expect(
      nativeMatchCaptureFracture(promotion.receipt, envelope, 'lattice-court'),
    ).toBe('contact')
    const enPassant = importChessPgn('1. e4 a6 2. e5 d5 3. exd6 *').game
    const receipt = enPassant.history[4]!
    const saved = createGummyMatchCapturePresentation(
      receipt,
      appearance('contact'),
    )!
    expect(saved.appearance.nativeFracture).toBe('points')
    expect(parseGummyMatchCaptures([saved], enPassant)).toEqual([saved])
    expect(nativeMatchCaptureFracture(receipt, saved, 'lattice-court')).toBe(
      'points',
    )
    expect(
      createGummyMatchCapturePresentation(
        receipt,
        defaultGummyMatchAppearance(),
      ),
    ).toBeUndefined()
    expect(
      nativeMatchCaptureFracture(promotion.receipt, saved, 'lattice-court'),
    ).toBe('points')
  })
})
