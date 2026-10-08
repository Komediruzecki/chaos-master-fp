/** Legal match controls retain one authoritative move while animation, history and cinema change views. */
import { cleanup, fireEvent, render, screen, waitFor, within, } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { popBack, pushBackHandler } from '@/lib/backStack'
import { GummyMatchPage } from './GummyMatchPage'
import { GUMMY_MATCH_CINEMA_KEY, GUMMY_MATCH_SESSION_KEY, loadGummyMatchSession, } from './gummyMatchSession'
import type { GummyMatchSceneProps } from '@/components/GummyBoard/GummyMatchScene'

const stubs = vi.hoisted(() => ({
  scene: undefined as GummyMatchSceneProps | undefined,
  copy: vi.fn(),
}))
vi.mock('@/components/GummyBoard/GummyMatchScene', () => ({
  GummyMatchScene: (props: GummyMatchSceneProps) => {
    stubs.scene = props
    props.onReady?.(true)
    return <canvas data-testid="gummy-match-canvas" />
  },
}))

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}
beforeEach(() => {
  vi.stubGlobal('localStorage', storage())
  vi.stubGlobal('sessionStorage', storage())
  vi.stubGlobal('navigator', { clipboard: { writeText: stubs.copy } })
  vi.clearAllMocks()
  stubs.copy.mockResolvedValue(undefined)
  stubs.scene = undefined
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function scene() {
  if (!stubs.scene) throw new Error('Match scene was not mounted')
  return stubs.scene
}

function play(from: string, to: string) {
  scene().onSquare(from)
  scene().onSquare(to)
}

function skip() {
  fireEvent.click(screen.getByRole('button', { name: 'Skip animation' }))
}

function importPgn(text: string) {
  fireEvent.click(screen.getByRole('tab', { name: 'Game & moves' }))
  const details = screen.getByText('Import or copy PGN').closest('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
  fireEvent.input(screen.getByLabelText('Game PGN'), {
    target: { value: text },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Import game' }))
}

describe('GummyMatchPage', () => {
  it('opens a restored version-one capture without mechanic metadata and keeps its replay available', () => {
    sessionStorage.setItem(
      GUMMY_MATCH_SESSION_KEY,
      JSON.stringify({ version: 1, pgn: '1. e4 d5 2. exd5 *', cursor: 3 }),
    )
    render(() => <GummyMatchPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Game & moves' }))
    expect(screen.getByRole('table', { name: 'Move history' })).toBeTruthy()
    expect(screen.getByText('Move 3 of 3')).toBeTruthy()
    expect(screen.queryByText(/Capture motion:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Replay move' }))
    expect(scene().receipt?.san).toBe('exd5')
    expect(scene().presentation?.mechanic).toBeUndefined()
    expect(scene().presentation?.motion).toEqual({
      shearOnset: 0.35,
      shearDistance: 1.1,
      contactHold: 0.35,
    })
  })

  it('applies collection cards without changing the game or its material tuning and restores the choice', () => {
    const view = render(() => <GummyMatchPage />)
    play('e2', 'e4')
    skip()
    const details = screen.getByText('Board and material').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }))
    fireEvent.click(screen.getByRole('button', { name: 'High: mushy' }))
    const previousSettings = scene().settings
    const previousPosition = scene().position
    fireEvent.click(screen.getByRole('button', { name: 'Lagoon collection' }))
    fireEvent.click(screen.getByRole('button', { name: 'Glass board' }))
    expect(scene().settings).toEqual({ ...previousSettings, palette: 'lagoon' })
    expect(scene().settings.tuning).toBe(previousSettings.tuning)
    expect(scene().position).toBe(previousPosition)
    expect(scene().receipt).toBeUndefined()
    expect(scene().theme).toBe('glass')
    expect(
      screen
        .getByRole('button', { name: 'Lagoon collection' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Glass board' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    view.unmount()
    render(() => <GummyMatchPage />)
    expect(scene().settings).toEqual({ ...previousSettings, palette: 'lagoon' })
    expect(scene().theme).toBe('glass')
    expect(scene().position.fen).toBe(previousPosition.fen)
    expect(screen.getByText('Move 1 of 1')).toBeTruthy()
  })

  it('locks look cards during a move and keeps the same scene across sidebar tabs and hiding', () => {
    render(() => <GummyMatchPage />)
    const initialScene = scene()
    play('e2', 'e4')
    const saved = sessionStorage.getItem(GUMMY_MATCH_SESSION_KEY)
    const collection = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Candy collection',
    })
    expect(collection.disabled).toBe(true)
    fireEvent.click(collection)
    expect(sessionStorage.getItem(GUMMY_MATCH_SESSION_KEY)).toBe(saved)
    skip()
    expect(collection.disabled).toBe(false)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Pieces & board' }), {
      key: 'ArrowRight',
    })
    expect(
      screen
        .getByRole('tab', { name: 'Game & moves' })
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(screen.getByRole('table', { name: 'Move history' })).toBeTruthy()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Hide controls' })[0]!,
    )
    expect(
      screen.queryByRole('complementary', { name: 'Match controls' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show controls' }))
    expect(
      screen.getByRole('complementary', { name: 'Match controls' }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('tab', { name: 'Game & moves' })
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(scene()).toBe(initialScene)
    expect(screen.getByText('Move 1 of 1')).toBeTruthy()
  })

  it('returns through the embedded Arcade callback and exposes a standalone destination', () => {
    const back = vi.fn()
    render(() => <GummyMatchPage onBackToArcade={back} />)
    const link = screen.getByRole('link', { name: 'Lumen Arcade' })
    expect(link.getAttribute('href')).toBe('/#arcade')
    expect(fireEvent.click(link)).toBe(false)
    expect(back).toHaveBeenCalledOnce()
  })

  it('restores the material, board finish, quality and scale with the reviewed game', () => {
    const view = render(() => <GummyMatchPage />)
    play('e2', 'e4')
    skip()
    const details = screen.getByText('Board and material').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    fireEvent.change(screen.getByLabelText('Board'), {
      target: { value: 'lava' },
    })
    fireEvent.change(screen.getByLabelText('Render quality'), {
      target: { value: 'tablet' },
    })
    fireEvent.input(screen.getByRole('slider', { name: /Piece size/ }), {
      target: { value: '94' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }))
    fireEvent.click(screen.getByRole('button', { name: 'High: mushy' }))
    view.unmount()
    render(() => <GummyMatchPage />)
    expect(scene().theme).toBe('lava')
    expect(scene().quality).toBe('tablet')
    expect(scene().scale).toBe(0.94)
    expect(scene().settings.softness).toBe(0.85)
    expect(scene().settings.fragility).toBe(0.9)
    expect(screen.getByText('Move 1 of 1')).toBeTruthy()
    expect(scene().position.turn).toBe('b')
  })

  it('prevents Cinema navigation when the match cannot be saved even if shot storage would succeed', () => {
    render(() => <GummyMatchPage />)
    importPgn('1. e4 d5 2. exd5 *')
    fireEvent.click(screen.getByRole('button', { name: 'Latest position' }))
    const setItem = sessionStorage.setItem.bind(sessionStorage)
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(
      (key: string, value: string) => {
        if (key === GUMMY_MATCH_SESSION_KEY)
          throw new Error('Match exceeds quota')
        setItem(key, value)
      },
    )
    expect(
      fireEvent.click(screen.getByRole('link', { name: 'Open in Cinema' })),
    ).toBe(false)
    expect(
      screen.getByText(
        /The match could not be saved, so the studio stayed closed/,
      ),
    ).toBeTruthy()
    expect(sessionStorage.getItem(GUMMY_MATCH_CINEMA_KEY)).toBeNull()
    expect(screen.getByText('Move 3 of 3')).toBeTruthy()
  })

  it('shows legal destinations and commits one move across skip, replay and stale completion', () => {
    render(() => <GummyMatchPage />)
    expect(screen.getByText('White to move')).toBeTruthy()
    scene().onSquare('e7')
    expect(scene().selectedSquare).toBeUndefined()
    scene().onSquare('e2')
    expect(scene().legalSquares).toEqual(['e3', 'e4'])
    scene().onSquare('e5')
    expect(scene().position.turn).toBe('w')
    expect(scene().receipt).toBeUndefined()
    play('e2', 'e4')
    const first = scene().receipt!
    expect(first.san).toBe('e4')
    expect(scene().position.turn).toBe('b')
    expect(
      scene().position.pieces.find((piece) => piece.square === 'e4')?.role,
    ).toBe('pawn')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Undo move' })
        .disabled,
    ).toBe(true)
    play('d7', 'd5')
    expect(scene().receipt).toBe(first)
    skip()
    fireEvent.click(screen.getByRole('button', { name: 'Replay move' }))
    expect(scene().receipt).not.toBe(first)
    expect(scene().receipt?.san).toBe('e4')
    scene().onComplete(first)
    expect(scene().receipt?.san).toBe('e4')
    scene().onComplete(scene().receipt!)
    expect(scene().receipt).toBeUndefined()
    expect(
      loadGummyMatchSession().session?.game.history.map((move) => move.san),
    ).toEqual(['e4'])
    fireEvent.click(screen.getByRole('button', { name: 'Undo move' }))
    expect(scene().position.turn).toBe('w')
    expect(
      scene().position.pieces.find((piece) => piece.square === 'e2')?.role,
    ).toBe('pawn')
    expect(screen.getByText('Move 0 of 0')).toBeTruthy()
  })

  it('requires an explicit promotion choice and supports underpromotion', () => {
    render(() => <GummyMatchPage />)
    importPgn('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n\n*')
    play('a7', 'a8')
    expect(scene().receipt).toBeUndefined()
    expect(screen.getByRole('group', { name: 'Choose promotion' })).toBeTruthy()
    for (const name of ['Queen', 'Rook', 'Bishop', 'Knight'])
      expect(screen.getByRole('button', { name })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rook' }))
    expect(
      scene().position.pieces.find((piece) => piece.square === 'a8')?.role,
    ).toBe('rook')
    expect(scene().receipt?.promotion).toBe('rook')
    expect(screen.queryByRole('group', { name: 'Choose promotion' })).toBeNull()
  })

  it('imports a mainline for non-destructive review and only branches on a new move', () => {
    render(() => <GummyMatchPage />)
    importPgn('1. e4 e5 2. Nf3 Nc6 *')
    expect(screen.getByText('Move 0 of 4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next move' }))
    expect(scene().position.turn).toBe('b')
    expect(screen.getByText('Move 1 of 4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Latest position' }))
    expect(screen.getByText('Move 4 of 4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'e4' }))
    expect(
      screen.getByText(/Playing a move here replaces the later moves/),
    ).toBeTruthy()
    play('c7', 'c5')
    skip()
    expect(
      loadGummyMatchSession().session?.game.history.map((move) => move.san),
    ).toEqual(['e4', 'c5'])
    expect(screen.getByText('Move 2 of 2')).toBeTruthy()
  })

  it('preserves the current game and cursor when PGN validation fails', () => {
    render(() => <GummyMatchPage />)
    play('e2', 'e4')
    skip()
    const fen = scene().position.fen
    const saved = sessionStorage.getItem(GUMMY_MATCH_SESSION_KEY)
    importPgn('1. e5 *')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(scene().position.fen).toBe(fen)
    expect(screen.getByText('Move 1 of 1')).toBeTruthy()
    expect(sessionStorage.getItem(GUMMY_MATCH_SESSION_KEY)).toBe(saved)
  })

  it('locks material and new-game controls during animation while leaving Skip available', () => {
    render(() => <GummyMatchPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Game & moves' }))
    play('e2', 'e4')
    expect(
      screen.getByLabelText('Render quality').closest('fieldset')?.disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'New game' })
        .disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Skip animation' })
        .disabled,
    ).toBe(false)
    skip()
    expect(
      screen.getByLabelText('Render quality').closest('fieldset')?.disabled,
    ).toBe(false)
  })

  it('opens the selected capture from its before position and restores the full game after remount', () => {
    const view = render(() => <GummyMatchPage />)
    importPgn('1. e4 d5 2. exd5 Qxd5 3. Nc3 *')
    fireEvent.click(screen.getByRole('button', { name: 'exd5' }))
    const link = screen.getByRole<HTMLAnchorElement>('link', {
      name: 'Open in Cinema',
    })
    expect(link.getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(link)
    const json: unknown = JSON.parse(
      sessionStorage.getItem(GUMMY_MATCH_CINEMA_KEY)!,
    )
    expect(json).toMatchObject({
      shot: {
        from: 'e4',
        to: 'd5',
        fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2',
      },
      material: { softness: 0.65, fragility: 0.7 },
    })
    expect(link.getAttribute('href')).toBe('/gummy?view=cinema&from=match')
    view.unmount()
    render(() => <GummyMatchPage />)
    expect(screen.getByText('Move 3 of 5')).toBeTruthy()
    expect(
      scene().position.pieces.find((piece) => piece.square === 'd5')?.color,
    ).toBe('w')
    fireEvent.click(screen.getByRole('tab', { name: 'Game & moves' }))
    expect(screen.getByRole('button', { name: 'Qxd5' })).toBeTruthy()
  })

  it('shows checkmate and keeps legal move entry disabled at the terminal position', () => {
    render(() => <GummyMatchPage />)
    importPgn('1. f3 e5 2. g4 Qh4# 0-1')
    fireEvent.click(screen.getByRole('button', { name: 'Latest position' }))
    expect(screen.getByText('Black wins by checkmate')).toBeTruthy()
    expect(
      screen.getByLabelText<HTMLSelectElement>('Piece to move').disabled,
    ).toBe(true)
    play('e2', 'e4')
    expect(scene().receipt).toBeUndefined()
  })

  it('dismisses the result before the Arcade world on native back', () => {
    const leaveWorld = vi.fn()
    const removeWorld = pushBackHandler(leaveWorld, 'arcade-chess')
    try {
      render(() => <GummyMatchPage />)
      importPgn('1. f3 e5 2. g4 Qh4# 0-1')
      fireEvent.click(screen.getByRole('button', { name: 'Latest position' }))
      expect(screen.getByRole('dialog', { name: 'Black wins' })).toBeTruthy()
      expect(popBack()).toBe(true)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(leaveWorld).not.toHaveBeenCalled()
      expect(popBack()).toBe(true)
      expect(leaveWorld).toHaveBeenCalledOnce()
    } finally {
      removeWorld()
    }
  })

  it('waits for a mating capture to finish before showing the result over the board', () => {
    render(() => <GummyMatchPage />)
    importPgn('[SetUp "1"]\n[FEN "7k/7r/6K1/7Q/8/8/8/8 w - - 0 1"]\n\n*')
    play('h5', 'h7')
    expect(scene().receipt?.san).toBe('Qxh7#')
    expect(scene().receipt?.kind).toBe('capture')
    expect(screen.queryByRole('dialog')).toBeNull()
    scene().onComplete(scene().receipt!)
    const result = screen.getByRole('dialog', { name: 'White wins' })
    expect(within(result).getByText('Checkmate')).toBeTruthy()
    expect(
      result.closest('[aria-label="Playable gummy chess board"]'),
    ).toBeTruthy()
    expect(
      within(result).getByRole('button', { name: 'Review board' }),
    ).toBeTruthy()
  })

  it('supports keyboard dismissal, reopening and a fresh game without resetting the material', async () => {
    render(() => <GummyMatchPage />)
    importPgn('1. f3 e5 2. g4 Qh4# 0-1')
    fireEvent.click(screen.getByRole('button', { name: 'Latest position' }))
    const result = screen.getByRole('dialog', { name: 'Black wins' })
    const review = within(result).getByRole('button', { name: 'Review board' })
    await waitFor(() => {
      expect(document.activeElement).toBe(review)
    })
    const finishedFen = scene().position.fen
    fireEvent.keyDown(review, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(scene().position.fen).toBe(finishedFen)
    const reopen = screen.getByRole('button', { name: 'Show result' })
    expect(document.activeElement).toBe(reopen)
    fireEvent.click(screen.getByRole('button', { name: 'Replay move' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    skip()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(reopen)
    const reopened = screen.getByRole('dialog', { name: 'Black wins' })
    const material = scene().settings
    fireEvent.click(within(reopened).getByRole('button', { name: 'New game' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('White to move')).toBeTruthy()
    expect(screen.getByText('Move 0 of 0')).toBeTruthy()
    expect(scene().position.pieces).toHaveLength(32)
    expect(scene().settings).toBe(material)
  })

  it('removes the result during history review and waits for the board to be ready', () => {
    render(() => <GummyMatchPage />)
    importPgn('1. f3 e5 2. g4 Qh4# 0-1')
    scene().onReady?.(false)
    fireEvent.click(screen.getByRole('button', { name: 'Latest position' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    scene().onReady?.(true)
    expect(screen.getByRole('dialog', { name: 'Black wins' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous move' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show result' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Latest position' }))
    expect(screen.getByRole('dialog', { name: 'Black wins' })).toBeTruthy()
  })

  it('offers a draw claim when available and preserves the claimed result', () => {
    render(() => <GummyMatchPage />)
    importPgn('1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 *')
    fireEvent.click(screen.getByRole('button', { name: 'Latest position' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Claim draw: threefold repetition' }),
    )
    expect(screen.getByText('Draw by threefold repetition')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Draw' })).toBeTruthy()
    expect(loadGummyMatchSession().session?.game.position.status).toBe('draw')
  })

  it('provides a selected PGN fallback when clipboard access is blocked', async () => {
    stubs.copy.mockRejectedValue(new Error('Clipboard blocked'))
    render(() => <GummyMatchPage />)
    importPgn('1. e4 d5 2. exd5 *')
    fireEvent.click(screen.getByRole('button', { name: 'Copy PGN' }))
    await waitFor(() => {
      expect(screen.getByText(/Copy was blocked/)).toBeTruthy()
    })
    const input = screen.getByLabelText<HTMLTextAreaElement>('Game PGN')
    expect(input.value).toContain('exd5')
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)
  })
})
