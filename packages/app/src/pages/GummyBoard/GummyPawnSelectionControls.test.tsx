/** Shape selection sends validated copies and retains active snapshots after library removal. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGummyAuthoredPawn, gummyAuthoredPawnKey, } from '@/simulation/gummy/gummyAuthoredPawn'
import { GUMMY_PAWN_EDIT_KEY, removeGummyPawnSnapshot, saveGummyPawnSnapshot, } from '../Pawn/gummyPawnLibrary'
import { GummyPawnSelectionControls } from './GummyPawnSelectionControls'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const choose = (value: string) =>
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Shape for both sides' }),
    { target: { value } },
  )
describe('shared gummy pawn selection', () => {
  it('applies the trial or a saved copy immediately and can restore the original pawn', () => {
    const saved = createGummyAuthoredPawn({ openness: 0.26 }, 'Open lattice')
    saveGummyPawnSnapshot(saved)
    const [value, setValue] = createSignal<GummyAuthoredPawn>()
    render(() => (
      <GummyPawnSelectionControls value={value()} onChange={setValue} />
    ))
    choose('trial')
    expect(value()).toEqual(
      createGummyAuthoredPawn(undefined, 'Crystal lattice', 1),
    )
    choose('crown')
    expect(value()).toEqual(createGummyAuthoredPawn(undefined, 'Open crown', 2))
    choose(gummyAuthoredPawnKey(saved))
    expect(value()).toEqual(saved)
    expect(value()).not.toBe(saved)
    choose('classic')
    expect(value()).toBeUndefined()
  })
  it('retains a selected snapshot when its library entry is removed and prepares an exact edit handoff', () => {
    const saved = createGummyAuthoredPawn({ openness: 0.28 }, 'Saved shape')
    saveGummyPawnSnapshot(saved)
    render(() => (
      <GummyPawnSelectionControls value={saved} onChange={vi.fn()} />
    ))
    removeGummyPawnSnapshot(gummyAuthoredPawnKey(saved))
    fireEvent(window, new Event('focus'))
    expect(
      screen.getByRole<HTMLOptionElement>('option', {
        name: 'Saved shape (match snapshot)',
      }).selected,
    ).toBe(true)
    const edit = screen.getByRole('link', {
      name: 'Edit this pawn in the Forge',
    })
    // Prevent test navigation while still exercising the real handoff handler.
    edit.addEventListener('click', (event) => {
      event.preventDefault()
    })
    fireEvent.click(edit)
    expect(JSON.parse(localStorage.getItem(GUMMY_PAWN_EDIT_KEY)!)).toEqual(
      saved,
    )
  })
  it('blocks selection while a capture is busy', () => {
    const change = vi.fn()
    render(() => <GummyPawnSelectionControls disabled onChange={change} />)
    choose('trial')
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true)
  })
})
