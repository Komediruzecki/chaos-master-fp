/** Board appearance persistence validates bounded IDs and keeps material presets untouched. */
import { describe, expect, it, vi } from 'vitest'
import { defaultGummyBoardAppearance, GUMMY_BOARD_APPEARANCE_KEY, loadGummyBoardAppearance, saveGummyBoardAppearance, } from './gummyBoardAppearance'

describe('gummy board appearance', () => {
  it('returns independent 90% Auto defaults when nothing is saved', () => {
    const storage = { getItem: () => null }
    const first = loadGummyBoardAppearance(storage).appearance
    const second = loadGummyBoardAppearance(storage).appearance
    expect(first).toEqual({
      paletteOverrides: {},
      pieceScale: 0.9,
      quality: 'auto',
    })
    first.paletteOverrides[3] = 'blue'
    expect(second.paletteOverrides).toEqual({})
  })
  it('round-trips selected piece colors, size and quality under its own key', () => {
    let json = ''
    const setItem = vi.fn((_key: string, value: string) => {
      json = value
    })
    const appearance = {
      ...defaultGummyBoardAppearance(),
      pieceScale: 0.95,
      quality: 'tablet' as const,
      paletteOverrides: { 2: 'berry' as const, 32: 'blue' as const },
    }
    saveGummyBoardAppearance(appearance, { setItem })
    expect(setItem).toHaveBeenCalledOnce()
    expect(setItem.mock.calls[0]![0]).toBe(GUMMY_BOARD_APPEARANCE_KEY)
    expect(loadGummyBoardAppearance({ getItem: () => json })).toEqual({
      appearance,
    })
  })
  it.each([
    '{',
    JSON.stringify({ version: 2, ...defaultGummyBoardAppearance() }),
    JSON.stringify({
      version: 1,
      ...defaultGummyBoardAppearance(),
      pieceScale: 2,
    }),
    JSON.stringify({
      version: 1,
      ...defaultGummyBoardAppearance(),
      quality: 'ultra',
    }),
    JSON.stringify({
      version: 1,
      ...defaultGummyBoardAppearance(),
      paletteOverrides: { 33: 'blue' },
    }),
    JSON.stringify({
      version: 1,
      ...defaultGummyBoardAppearance(),
      paletteOverrides: { 1: 'red' },
    }),
    ' '.repeat(16_385),
  ])(
    'recovers safely from unsupported or damaged appearance without writing over it',
    (json) => {
      const result = loadGummyBoardAppearance({ getItem: () => json })
      expect(result.appearance).toEqual(defaultGummyBoardAppearance())
      expect(result.error).toBe(
        'Saved board appearance could not be loaded. The defaults are shown.',
      )
    },
  )
  it('handles blocked reads and propagates blocked writes to the visible control state', () => {
    expect(
      loadGummyBoardAppearance({
        getItem: () => {
          throw new Error('denied')
        },
      }).error,
    ).toBeTruthy()
    expect(() => {
      saveGummyBoardAppearance(defaultGummyBoardAppearance(), {
        setItem: () => {
          throw new Error('denied')
        },
      })
    }).toThrow('denied')
  })
})
