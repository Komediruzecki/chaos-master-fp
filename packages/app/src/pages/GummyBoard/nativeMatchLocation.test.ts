/** Preview handoffs select valid collections while preserving unrelated URL state. */
import { describe, expect, it } from 'vitest'
import { consumeNativeMatchSelection, nativeMatchSelectionFromSearch, } from './nativeMatchLocation'

describe('native match handoff', () => {
  it('accepts supported collections with an explicit or default enclosure', () => {
    expect(nativeMatchSelectionFromSearch('?collection=wild-canopy')).toEqual({
      version: 1,
      id: 'wild-canopy',
      enclosure: 'pure',
    })
    expect(
      nativeMatchSelectionFromSearch(
        '?collection=lattice-court&enclosure=glass',
      ),
    ).toEqual({
      version: 1,
      id: 'lattice-court',
      enclosure: 'glass',
    })
  })
  it.each([
    '',
    '?collection=unknown',
    '?collection=tidal-relics&enclosure=both',
    '?enclosure=glass',
  ])('ignores malformed or absent choices: %s', (search) => {
    expect(nativeMatchSelectionFromSearch(search)).toBeUndefined()
  })
  it('consumes the initial choice so subsequent reloads retain the saved comparison', () => {
    const original = window.location.href
    try {
      window.history.replaceState(
        null,
        '',
        '/gummy?view=match&collection=tidal-relics&enclosure=glass#test',
      )
      expect(consumeNativeMatchSelection()?.id).toBe('tidal-relics')
      expect(window.location.search).toBe('?view=match')
      expect(window.location.hash).toBe('#test')
      expect(consumeNativeMatchSelection()).toBeUndefined()
    } finally {
      window.history.replaceState(null, '', original)
    }
  })
})
