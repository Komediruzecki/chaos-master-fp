/** Forge save/edit/reload keeps original experiments and saved chess snapshots independent. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGummyAuthoredPawnFlame, createGummyAuthoredPawn, gummyAuthoredPawnKey, } from '@/simulation/gummy/gummyAuthoredPawn'
import { gummyPawnForgeUrl, loadGummyPawnLibrary, prepareGummyPawnEdit, readGummyPawnForForge, saveGummyPawnSnapshot, } from './gummyPawnLibrary'
import { buildPawnDesignFlame, createPawnDesign, createPawnDesignDraft, restorePawnDesignDraft, } from './pawnDesign'
import { PawnPage } from './PawnPage'
import type { PawnStageProps } from '@/components/PawnStage/PawnStage'

const fixtures = vi.hoisted(() => ({
  stage: undefined as PawnStageProps | undefined,
}))
vi.mock('@/components/PawnStage/PawnStage', () => ({
  PawnStage: (props: PawnStageProps) => {
    fixtures.stage = props
    return <div aria-label="Mock source preview" />
  },
}))
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))
const draftKey = 'chaos-master-pawn-forge-experiments'
let oldUrl = ''
beforeEach(() => {
  oldUrl = window.location.href
  window.history.replaceState(null, '', '/pawn')
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  })
  fixtures.stage = undefined
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', oldUrl)
})
const input = (name: string | RegExp, value: string) =>
  fireEvent.input(screen.getByLabelText(name, { selector: 'input' }), {
    target: { value },
  })

describe('Forge chess-pawn library', () => {
  it('saves the edited lattice, reopens its playable source and updates a separate snapshot', () => {
    const original = createPawnDesign()
    original.recipes.echo.openness = 0.17
    original.recipes.lattice.openness = 0.33
    localStorage.setItem(
      draftKey,
      JSON.stringify(createPawnDesignDraft(original)),
    )
    const mounted = render(() => <PawnPage />)
    input('Saved pawn name', 'My lattice')
    input(/^Openness/, '54')
    fireEvent.click(screen.getByRole('button', { name: 'Save for chess' }))
    const saved = loadGummyPawnLibrary().pawns[0]!
    expect(saved.name).toBe('My lattice')
    expect(saved.recipe.openness).toBe(0.54)
    expect(fixtures.stage?.flame).toEqual(buildGummyAuthoredPawnFlame(saved))
    expect(
      screen.getByText(
        'My lattice saved. Choose it under Pawn shape in Chess.',
      ),
    ).toBeTruthy()
    const draftBeforeEditing = localStorage.getItem(draftKey)
    mounted.unmount()
    window.history.replaceState(null, '', prepareGummyPawnEdit(saved))
    render(() => <PawnPage />)
    expect(
      screen.getByLabelText<HTMLInputElement>('Saved pawn name').value,
    ).toBe('My lattice')
    expect(fixtures.stage?.flame).toEqual(buildGummyAuthoredPawnFlame(saved))
    input(/^Openness/, '78')
    const previewBeforeRename = fixtures.stage?.flame
    input('Saved pawn name', 'My lattice revised')
    expect(fixtures.stage?.flame).toBe(previewBeforeRename)
    expect(loadGummyPawnLibrary().pawns[0]).toEqual(saved)
    expect(localStorage.getItem(draftKey)).toBe(draftBeforeEditing)
    fireEvent.click(screen.getByRole('button', { name: 'Update saved pawn' }))
    const updated = loadGummyPawnLibrary().pawns[0]!
    expect(loadGummyPawnLibrary().pawns).toHaveLength(1)
    expect(updated.name).toBe('My lattice revised')
    expect(updated.recipe.openness).toBe(0.78)
    expect(readGummyPawnForForge(window.location.search).pawn).toEqual(updated)
    expect(
      readGummyPawnForForge(
        new URL(gummyPawnForgeUrl(updated), window.location.origin).search,
      ).pawn,
    ).toEqual(updated)
    expect(localStorage.getItem(draftKey)).toBe(draftBeforeEditing)
  })
  it('can inspect and edit Echo during a saved lattice edit without overwriting the lattice draft', () => {
    const design = createPawnDesign()
    design.selected = 'lattice'
    design.recipes.echo.openness = 0.23
    design.recipes.lattice.openness = 0.81
    localStorage.setItem(
      draftKey,
      JSON.stringify(createPawnDesignDraft(design)),
    )
    const opened = createGummyAuthoredPawn({ openness: 0.46 }, 'Saved lattice')
    window.history.replaceState(null, '', prepareGummyPawnEdit(opened))
    render(() => <PawnPage />)
    input(/^Openness/, '64')
    fireEvent.click(screen.getByRole('radio', { name: 'Glass echo' }))
    expect(
      screen.getByRole('button', { name: 'Save for chess' }).closest('fieldset')
        ?.disabled,
    ).toBe(true)
    expect(fixtures.stage?.flame).toEqual(
      buildPawnDesignFlame('echo', design.recipes.echo),
    )
    input(/^Openness/, '35')
    const stored = restorePawnDesignDraft(
      JSON.parse(localStorage.getItem(draftKey)!),
    )
    expect(stored.recipes.echo.openness).toBe(0.35)
    expect(stored.recipes.lattice).toEqual(design.recipes.lattice)
    fireEvent.click(screen.getByRole('radio', { name: 'Crystal lattice' }))
    expect(
      screen.getByLabelText<HTMLInputElement>(/^Openness/, {
        selector: 'input',
      }).value,
    ).toBe('64')
    fireEvent.click(
      screen.getByRole('button', { name: 'Return to Forge draft' }),
    )
    expect(
      screen.getByLabelText<HTMLInputElement>(/^Openness/, {
        selector: 'input',
      }).value,
    ).toBe('81')
  })
  it('opens the built-in trial without replacing either prior draft and supports removing only the selected saved copy', () => {
    const design = createPawnDesign()
    design.selected = 'echo'
    localStorage.setItem(
      draftKey,
      JSON.stringify(createPawnDesignDraft(design)),
    )
    const before = localStorage.getItem(draftKey)
    const other = createGummyAuthoredPawn({ openness: 0.1 }, 'Other')
    saveGummyPawnSnapshot(other)
    window.history.replaceState(null, '', '/pawn?chessPawn=trial')
    render(() => <PawnPage />)
    expect(
      screen.getByLabelText<HTMLInputElement>('Saved pawn name').value,
    ).toBe('Crystal lattice')
    fireEvent.click(screen.getByRole('button', { name: 'Save for chess' }))
    expect(loadGummyPawnLibrary().pawns).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved pawn' }))
    expect(loadGummyPawnLibrary().pawns.map(gummyAuthoredPawnKey)).toEqual([
      gummyAuthoredPawnKey(other),
    ])
    expect(localStorage.getItem(draftKey)).toBe(before)
    fireEvent.click(
      screen.getByRole('button', { name: 'Return to Forge draft' }),
    )
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Glass echo' })
        .checked,
    ).toBe(true)
    expect(window.location.search).toBe('')
  })
  it('keeps invalid opening references and unavailable storage recoverable', () => {
    window.history.replaceState(null, '', '/pawn?chessPawn=missing')
    render(() => <PawnPage />)
    expect(screen.getByRole('alert').textContent).toContain(
      'Your Forge draft is still available',
    )
    input('Saved pawn name', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save for chess' }))
    expect(screen.getAllByRole('alert').at(-1)?.textContent).toContain(
      'Give this pawn a name',
    )
    expect(loadGummyPawnLibrary().pawns).toEqual([])
  })
})
