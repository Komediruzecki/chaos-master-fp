/** Collection changes preserve gummy choices and use static images instead of extra GPU scenes. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GummyMatchLookCards } from './GummyMatchLookCards'
import type { NativeChessCollectionSelection } from './gummyMatchAppearance'

afterEach(cleanup)

describe('playable collection cards', () => {
  it('switches native collections and enclosure while preserving the gummy palette and board', () => {
    const [nativeCollection, setNativeCollection] =
      createSignal<NativeChessCollectionSelection>()
    const palette = vi.fn(),
      theme = vi.fn()
    const { container } = render(() => (
      <GummyMatchLookCards
        palette="lagoon"
        theme="lava"
        busy={false}
        nativeCollection={nativeCollection()}
        onNativeCollection={setNativeCollection}
        onPalette={palette}
        onTheme={theme}
      />
    ))
    expect(
      screen
        .getByRole('button', { name: 'Lagoon collection' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Fractals' }))
    expect(nativeCollection()).toEqual({
      version: 1,
      id: 'wild-canopy',
      enclosure: 'pure',
    })
    expect(screen.queryByRole('button', { name: 'Lava board' })).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Tidal Relics collection' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Glass study' }))
    expect(nativeCollection()).toEqual({
      version: 1,
      id: 'tidal-relics',
      enclosure: 'glass',
    })
    expect(
      screen.getByText(/Glass encloses this collection’s bishop/),
    ).toBeTruthy()
    expect(
      screen
        .getByRole<HTMLAnchorElement>('link', {
          name: 'Compare in the collection preview',
        })
        .getAttribute('href'),
    ).toContain('collection=tidal-relics&enclosure=glass')
    expect(container.querySelectorAll('canvas')).toHaveLength(0)
    expect(
      [...container.querySelectorAll('img')].every((image) =>
        image.src.endsWith('.svg'),
      ),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Gummy' }))
    expect(nativeCollection()).toBeUndefined()
    expect(
      screen
        .getByRole('button', { name: 'Lagoon collection' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Lava board' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(palette).not.toHaveBeenCalled()
    expect(theme).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Fractals' }))
    expect(nativeCollection()).toEqual({
      version: 1,
      id: 'tidal-relics',
      enclosure: 'glass',
    })
  })

  it('disables piece family, collection and presentation controls during a move', () => {
    const change = vi.fn()
    render(() => (
      <GummyMatchLookCards
        palette="marble"
        theme="classic"
        busy
        nativeCollection={{
          version: 1,
          id: 'lattice-court',
          enclosure: 'glass',
        }}
        onNativeCollection={change}
        onPalette={vi.fn()}
        onTheme={vi.fn()}
      />
    ))
    for (const name of [
      'Gummy',
      'Fractals',
      'Lattice Court collection',
      'Pure fractals',
      'Glass study',
    ])
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name }).disabled,
      ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Pure fractals' }))
    expect(change).not.toHaveBeenCalled()
  })
})
