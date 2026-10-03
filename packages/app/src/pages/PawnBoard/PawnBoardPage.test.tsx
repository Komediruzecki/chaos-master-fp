/** Board-page controls, capture sequencing and saved shapes with a GPU-free scene. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { onMount } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPawnDesignDraft } from '@/pages/Pawn/pawnDesign'
import { createPawnDraft } from '@/pages/Pawn/pawnDraft'
import { PawnBoardPage } from './PawnBoardPage'
import type { PawnBoardSceneProps } from '@/components/PawnBoard/PawnBoardScene'
import type { PawnDesign } from '@/pages/Pawn/pawnDesign'

const stubs = vi.hoisted(() => ({
  scene: undefined as PawnBoardSceneProps | undefined,
}))

vi.mock('@/components/PawnBoard/PawnBoardScene', () => ({
  PawnBoardScene: (props: PawnBoardSceneProps) => {
    stubs.scene = props
    onMount(() => props.onReady?.(true))
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            props.onSquarePick({ file: 3, rank: 3 })
          }}
        >
          Pick d4
        </button>
        <button
          type="button"
          onClick={() => {
            props.onSquarePick({ file: 4, rank: 4 })
          }}
        >
          Pick e5
        </button>
        <button
          type="button"
          onClick={() => {
            props.onSquarePick({ file: 0, rank: 6 })
          }}
        >
          Pick a7
        </button>
        <button type="button" onClick={() => props.onAnimationComplete?.()}>
          Finish animation
        </button>
      </div>
    )
  },
}))

// Node's localStorage is not a working Storage in the app test environment.
const stored = new Map<string, string>()
const writeStorage = vi.fn((key: string, value: string) => {
  stored.set(key, value)
})
const memoryStorage: Storage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: writeStorage,
  removeItem: (key) => {
    stored.delete(key)
  },
  clear: () => {
    stored.clear()
  },
  key: (index) => [...stored.keys()][index] ?? null,
  get length() {
    return stored.size
  },
}

function mockMotionPreference() {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const matches = vi.spyOn(preference, 'matches', 'get').mockReturnValue(false)
  const add = vi.spyOn(preference, 'addEventListener')
  const remove = vi.spyOn(preference, 'removeEventListener')
  vi.spyOn(window, 'matchMedia').mockReturnValue(preference)
  return { preference, matches, add, remove }
}

let motion: ReturnType<typeof mockMotionPreference>
let oldTitle: string

beforeEach(() => {
  window.history.replaceState(null, '', '/chess')
  stored.clear()
  writeStorage.mockClear()
  vi.stubGlobal('localStorage', memoryStorage)
  stubs.scene = undefined
  motion = mockMotionPreference()
  oldTitle = document.title
})

afterEach(() => {
  cleanup()
  document.title = oldTitle
  stored.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function scene() {
  if (!stubs.scene) throw new Error('The pawn board scene was not mounted')
  return stubs.scene
}

function pawnPicker() {
  return screen.getByRole<HTMLSelectElement>('combobox', {
    name: 'Choose a pawn',
  })
}

function count(side: 'Frost' | 'Ember') {
  return Number(
    screen.getByText(side, { selector: 'span' }).querySelector('b')
      ?.textContent,
  )
}

function formField() {
  return screen.getByRole<HTMLFieldSetElement>('group', { name: 'Pawn form' })
}

const FORGE_KEY = 'chaos-master-pawn-forge-experiments'
const LEGACY_KEY = 'chaos-master-pawn-forge-draft'

describe('PawnBoardPage play', () => {
  it('inspects the new branching form without changing the game, and toggles its glass and palette', () => {
    render(() => <PawnBoardPage />)
    expect(scene().form).toBe('blue-branch')
    expect(scene().showGlass).toBe(true)
    const originalGame = scene().game
    fireEvent.click(screen.getByRole('button', { name: 'Inspect pawn' }))
    expect(scene().inspection).toBe(true)
    expect(scene().game).toBe(originalGame)
    expect(screen.queryByRole('combobox', { name: 'Choose a pawn' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Glass shell' }))
    expect(scene().showGlass).toBe(false)
    fireEvent.click(screen.getByRole('radio', { name: 'Ember' }))
    expect(scene().inspectionSide).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    expect(scene().inspection).toBe(false)
    expect(scene().game).toBe(originalGame)
    expect(pawnPicker().disabled).toBe(false)
    expect(writeStorage).not.toHaveBeenCalled()
  })

  it('opens a direct inspection link and returns to play when loading a capture', () => {
    window.history.replaceState(null, '', '/chess?view=study')
    render(() => <PawnBoardPage />)
    expect(scene().inspection).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Capture demo' }))
    expect(scene().inspection).toBe(false)
    expect(pawnPicker().value).toBe('light_3')
  })
  it('captures the demo pawn, locks actions until animation finishes, then hands Ember the turn', () => {
    render(() => <PawnBoardPage />)
    expect(screen.getByRole('status').textContent).toBe('Frost to move')
    expect([count('Frost'), count('Ember')]).toEqual([8, 8])

    fireEvent.click(screen.getByRole('button', { name: 'Capture demo' }))
    expect(pawnPicker().value).toBe('light_3')
    expect(scene().selected).toEqual({ file: 3, rank: 3 })
    expect(scene().legalSquares).toContainEqual({ file: 4, rank: 4 })
    expect(screen.getByText('From d4')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Capture on e5' }))
    expect([count('Frost'), count('Ember')]).toEqual([8, 7])
    expect(scene().game.pieces.some((piece) => piece.id === 'dark_4')).toBe(
      false,
    )
    expect(scene().move).toMatchObject({
      side: 'light',
      pieceId: 'light_3',
      kind: 'capture',
      from: { file: 3, rank: 3 },
      to: { file: 4, rank: 4 },
      captured: { id: 'dark_4', side: 'dark', square: { file: 4, rank: 4 } },
    })
    expect(screen.getByRole('status').textContent).toBe(
      'Shattering the captured pawn…',
    )
    expect(pawnPicker().disabled).toBe(true)
    expect(formField().disabled).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Capture demo' })
        .disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'New game' })
        .disabled,
    ).toBe(true)
    expect(screen.getByText('Frost: d4 to e5 (capture)')).toBeTruthy()

    const duringCapture = scene().game
    fireEvent.click(screen.getByRole('button', { name: 'Pick a7' }))
    expect(scene().game).toBe(duringCapture)
    expect(scene().game.selectedId).toBeUndefined()
    expect(scene().game.history).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Finish animation' }))
    expect(screen.getByRole('status').textContent).toBe('Ember to move')
    expect(scene().move).toBeUndefined()
    expect(pawnPicker().disabled).toBe(false)
    expect(formField().disabled).toBe(false)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'New game' })
        .disabled,
    ).toBe(false)
    expect(screen.queryByRole('option', { name: 'Ember at e5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pick a7' }))
    expect(pawnPicker().value).toBe('dark_0')
    expect(screen.getByText('From a7')).toBeTruthy()
  })

  it('moves a standard pawn through the dropdown and its available double step', () => {
    render(() => <PawnBoardPage />)
    fireEvent.change(pawnPicker(), { target: { value: 'light_0' } })
    expect(scene().selected).toEqual({ file: 0, rank: 1 })
    expect(screen.getByRole('button', { name: 'Move to a3' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Move to a4' }))
    expect(
      scene().game.pieces.find((piece) => piece.id === 'light_0')?.square,
    ).toEqual({ file: 0, rank: 3 })
    expect(scene().move).toMatchObject({
      kind: 'double',
      enPassant: false,
    })
    expect(scene().move?.captured).toBeUndefined()
    expect([count('Frost'), count('Ember')]).toEqual([8, 8])
    expect(screen.getByRole('status').textContent).toBe('Moving the pawn…')
    expect(pawnPicker().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Finish animation' }))
    expect(screen.getByRole('status').textContent).toBe('Ember to move')
    expect(screen.getByText('Frost: a2 to a4')).toBeTruthy()
    expect(pawnPicker().disabled).toBe(false)
  })

  it('routes scene square picks through selection, capture and a fresh game reset', () => {
    render(() => <PawnBoardPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture demo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick d4' }))
    expect(pawnPicker().value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Pick d4' }))
    expect(pawnPicker().value).toBe('light_3')
    fireEvent.click(screen.getByRole('button', { name: 'Pick e5' }))
    expect(scene().game.history).toHaveLength(1)
    expect(count('Ember')).toBe(7)
    fireEvent.click(screen.getByRole('button', { name: 'Finish animation' }))
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    expect([count('Frost'), count('Ember')]).toEqual([8, 8])
    expect(scene().game.history).toEqual([])
    expect(pawnPicker().value).toBe('')
    expect(screen.getByRole('status').textContent).toBe('Frost to move')
    expect(screen.getByText('No moves yet')).toBeTruthy()
  })
})

describe('PawnBoardPage saved design and lifecycle', () => {
  it('uses independent saved form recipes and never overwrites either Forge draft', () => {
    const design: PawnDesign = {
      selected: 'lattice',
      recipes: {
        echo: { branchCount: 8, openness: 0.2, twist: 1.1, side: 'dark' },
        lattice: { branchCount: 3, openness: 0.8, twist: -0.6, side: 'light' },
      },
    }
    const forge = JSON.stringify(createPawnDesignDraft(design))
    const legacy = JSON.stringify(
      createPawnDraft({
        branchCount: 5,
        openness: 0.4,
        twist: 2,
        side: 'light',
      }),
    )
    stored.set(FORGE_KEY, forge)
    stored.set(LEGACY_KEY, legacy)
    render(() => <PawnBoardPage />)
    fireEvent.click(screen.getByRole('radio', { name: 'Crystal lattice' }))
    expect(scene().form).toBe('lattice')
    expect(scene().lightRecipe).toEqual(design.recipes.lattice)
    expect(scene().darkRecipe).toEqual({
      ...design.recipes.lattice,
      side: 'dark',
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Glass echo' }))
    expect(scene().form).toBe('echo')
    expect(scene().lightRecipe).toEqual({
      ...design.recipes.echo,
      side: 'light',
    })
    expect(scene().darkRecipe).toEqual(design.recipes.echo)
    fireEvent.click(screen.getByRole('button', { name: 'Capture demo' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Crystal lattice' }))
    expect(scene().form).toBe('lattice')
    expect(scene().lightRecipe).toEqual(design.recipes.lattice)
    expect(pawnPicker().value).toBe('light_3')
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(scene().resetViewKey).toBe(1)
    expect(stored.get(FORGE_KEY)).toBe(forge)
    expect(stored.get(LEGACY_KEY)).toBe(legacy)
    expect(writeStorage).not.toHaveBeenCalled()
  })

  it('follows reduced motion and restores the document title, meta and listener on cleanup', () => {
    document.title = 'Previous page'
    const beforeRobots = document.head.querySelectorAll(
      'meta[name="robots"]',
    ).length
    const page = render(() => <PawnBoardPage />)
    expect(document.title).toBe('Pawn Board · Lumen Apeiron')
    expect(document.head.querySelectorAll('meta[name="robots"]').length).toBe(
      beforeRobots + 1,
    )
    expect(scene().reducedMotion).toBe(false)
    motion.matches.mockReturnValue(true)
    motion.preference.dispatchEvent(new Event('change'))
    expect(scene().reducedMotion).toBe(true)
    const listener = motion.add.mock.calls.find(
      ([type]) => type === 'change',
    )?.[1]
    expect(listener).toBeTypeOf('function')
    page.unmount()
    expect(document.title).toBe('Previous page')
    expect(document.head.querySelectorAll('meta[name="robots"]').length).toBe(
      beforeRobots,
    )
    expect(motion.remove).toHaveBeenCalledWith('change', listener)
  })
})
