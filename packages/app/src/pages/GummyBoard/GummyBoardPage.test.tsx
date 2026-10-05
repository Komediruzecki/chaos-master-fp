/** Board controls route shared material, playback and recording state to one isolated scene. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GummyBearApp } from '../GummyBear/GummyBearApp'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
import { loadGummyPresets } from '../GummyBear/gummyPresets'
import { GUMMY_BOARD_APPEARANCE_KEY, loadGummyBoardAppearance, } from './gummyBoardAppearance'
import { GummyBoardPage } from './GummyBoardPage'
import type { ParentProps } from 'solid-js'
import type { GummyBoardSceneProps } from '@/components/GummyBoard/GummyBoardScene'
import type { LiveCanvasRecordingOptions } from '@/utils/liveCanvasRecorder'

const stubs = vi.hoisted(() => ({
  scene: undefined as GummyBoardSceneProps | undefined,
  holdReady: false,
  recording: undefined as LiveCanvasRecordingOptions | undefined,
  start: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
  download: vi.fn(),
}))
vi.mock('@/components/GummyBoard/GummyBoardScene', () => ({
  GummyBoardScene: (props: GummyBoardSceneProps) => {
    stubs.scene = props
    if (!stubs.holdReady) props.onReady?.(true)
    return <canvas data-testid="gummy-board-canvas" />
  },
}))
vi.mock('@/components/StandalonePage/StandalonePage', () => ({
  StandalonePage: (props: ParentProps) => <>{props.children}</>,
}))
vi.mock('../GummyBear/GummyBearPage', () => ({
  GummyBearPage: () => <div data-testid="gummy-workbench" />,
}))
vi.mock('@/utils/liveCanvasRecorder', () => ({
  supportsLiveCanvasRecording: () => true,
  startLiveCanvasRecording: stubs.start,
}))
vi.mock('@/utils/blob', () => ({ downloadBlob: stubs.download }))

let oldTitle: string
let oldUrl: string
beforeEach(() => {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
  })
  oldTitle = document.title
  oldUrl = window.location.href
  stubs.scene = undefined
  stubs.recording = undefined
  stubs.holdReady = false
  vi.clearAllMocks()
  stubs.start.mockImplementation(
    (_canvas: HTMLCanvasElement, callbacks: LiveCanvasRecordingOptions) => {
      stubs.recording = callbacks
      return { stop: stubs.stop, dispose: stubs.dispose }
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.title = oldTitle
  window.history.replaceState(null, '', oldUrl)
})

function scene() {
  if (!stubs.scene) throw new Error('Board scene was not mounted')
  return stubs.scene
}

describe('GummyBoardPage', () => {
  it('starts with an independent exact RockGummy material and a board-wide orbit view', () => {
    render(() => <GummyBoardPage />)
    const rock = GUMMY_BUILTIN_PRESETS.find((item) => item.id === 'rockgummy')!
      .preset.settings
    expect(scene().settings).toEqual(rock)
    expect(scene().settings).not.toBe(rock)
    expect(scene().settings.tuning).not.toBe(rock.tuning)
    expect(scene().view).toBe('board')
    expect(scene().mode).toBe('orbit')
    expect(scene().collisionMode).toBe('driven')
    expect(scene().impact).toBe(1)
    expect(scene().crashKey).toBe(0)
    expect(screen.getByRole('button', { name: 'Play crash' })).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Gummy workbench' })
        .getAttribute('href'),
    ).toBe('/gummy?experiment=mpm')
  })

  it('edits one selected piece without resetting the shot and restores its distinct default', () => {
    render(() => <GummyBoardPage />)
    expect(scene().pieceScale).toBe(0.9)
    expect(scene().quality).toBe('auto')
    const pieces = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Piece',
    })
    expect(pieces.options).toHaveLength(33)
    expect([...pieces.options].map((option) => option.textContent)).toContain(
      'White bishop · c1',
    )
    scene().onSelectPiece?.(3)
    expect(scene().selectedPieceId).toBe(3)
    expect(pieces.value).toBe('3')
    expect(screen.getByText('Board appearance').closest('details')?.open).toBe(
      true,
    )
    const palette = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Piece palette',
    })
    expect(palette.value).toBe('lagoon')
    fireEvent.change(palette, { target: { value: 'blue' } })
    expect(scene().paletteOverrides).toEqual({ 3: 'blue' })
    expect(scene().resetKey).toBe(0)
    expect(loadGummyBoardAppearance().appearance.paletteOverrides).toEqual({
      3: 'blue',
    })
    fireEvent.change(pieces, { target: { value: '2' } })
    expect(scene().selectedPieceId).toBe(2)
    expect(palette.value).toBe('amber')
    fireEvent.change(palette, { target: { value: 'berry' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset piece color' }))
    expect(scene().paletteOverrides).toEqual({ 3: 'blue' })
    expect(palette.value).toBe('amber')
    fireEvent.click(screen.getByRole('button', { name: 'Reset all colors' }))
    expect(scene().paletteOverrides).toEqual({})
    expect(scene().resetKey).toBe(0)
  })

  it('keeps appearance independent of presets and restores it after remount', () => {
    const first = render(() => <GummyBoardPage />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Piece' }), {
      target: { value: '4' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Piece palette' }), {
      target: { value: 'candy' },
    })
    fireEvent.input(screen.getByRole('slider', { name: /Piece size/ }), {
      target: { value: '95' },
    })
    expect(scene().pieceScale).toBe(0.95)
    expect(scene().resetKey).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }))
    fireEvent.click(screen.getByRole('button', { name: 'High: mushy' }))
    expect(scene().paletteOverrides).toEqual({ 4: 'candy' })
    expect(scene().pieceScale).toBe(0.95)
    first.unmount()
    render(() => <GummyBoardPage />)
    expect(scene().paletteOverrides).toEqual({ 4: 'candy' })
    expect(scene().pieceScale).toBe(0.95)
    expect(scene().selectedPieceId).toBeUndefined()
  })

  it('resets on quality changes while preserving physics and stops an active recording', () => {
    render(() => <GummyBoardPage />)
    const original = scene().settings
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Render quality' }), {
      target: { value: 'tablet' },
    })
    expect(scene().quality).toBe('tablet')
    expect(scene().settings).toBe(original)
    expect(scene().resetKey).toBe(1)
    expect(stubs.stop).toHaveBeenCalledWith(
      'Recording finished because render quality changed.',
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Render quality' }), {
      target: { value: 'tablet' },
    })
    expect(scene().resetKey).toBe(1)
    expect(loadGummyBoardAppearance().appearance.quality).toBe('tablet')
  })

  it('shows damaged storage and preserves it until an explicit appearance change', () => {
    localStorage.setItem(GUMMY_BOARD_APPEARANCE_KEY, '{invalid')
    render(() => <GummyBoardPage />)
    expect(
      screen.getByText(
        'Saved board appearance could not be loaded. The defaults are shown.',
      ),
    ).toBeTruthy()
    expect(localStorage.getItem(GUMMY_BOARD_APPEARANCE_KEY)).toBe('{invalid')
    fireEvent.input(screen.getByRole('slider', { name: /Piece size/ }), {
      target: { value: '95' },
    })
    expect(loadGummyBoardAppearance().appearance.pieceScale).toBe(0.95)
    expect(
      screen.queryByText(
        'Saved board appearance could not be loaded. The defaults are shown.',
      ),
    ).toBeNull()
  })

  it('switches collision models with a fresh take while preserving material and camera', () => {
    render(() => <GummyBoardPage />)
    const original = scene().settings
    fireEvent.click(screen.getByRole('button', { name: 'Soft contact' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play crash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Driven rook' }))
    expect(scene().collisionMode).toBe('driven')
    expect(scene().resetKey).toBe(2)
    expect(scene().crashKey).toBe(1)
    expect(scene().paused).toBe(false)
    expect(scene().settings).toBe(original)
    expect(scene().view).toBe('close')
    expect(
      screen
        .getByRole('button', { name: 'Driven rook' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByText('Pawn material')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Driven rook' }))
    expect(scene().resetKey).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Soft contact' }))
    expect(scene().collisionMode).toBe('soft')
    expect(scene().resetKey).toBe(3)
    expect(scene().settings).toBe(original)
    expect(screen.getByText('Piece material')).toBeTruthy()
  })

  it('finishes recording before changing the collision model', () => {
    render(() => <GummyBoardPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Driven rook' }))
    expect(stubs.stop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Soft contact' }))
    expect(stubs.stop).toHaveBeenCalledWith(
      'Recording finished because the collision model changed.',
    )
    expect(scene().resetKey).toBe(1)
  })

  it('plays, pauses, replays and cancels the strike without replacing the material', () => {
    render(() => <GummyBoardPage />)
    const original = scene().settings
    fireEvent.click(screen.getByRole('button', { name: 'Play crash' }))
    expect(scene().crashKey).toBe(1)
    scene().onPhase?.('crushing')
    expect(
      screen.getByRole('status', { name: 'Board status' }).textContent,
    ).toBe('Crushing the pawn')
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(scene().paused).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Replay crash' }))
    expect(scene().crashKey).toBe(2)
    expect(scene().paused).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Reset board' }))
    expect(scene().resetKey).toBe(1)
    expect(scene().crashKey).toBe(2)
    expect(scene().settings).toBe(original)
    expect(
      screen.getByRole('status', { name: 'Board status' }).textContent,
    ).toBe('Ready to crash')
  })

  it('uses the shared preset library and resets an active strike when a preset is applied', () => {
    render(() => <GummyBoardPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }))
    fireEvent.input(screen.getByRole('textbox', { name: 'Preset name' }), {
      target: { value: 'Board take' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    const saved = loadGummyPresets().presets
    expect(saved).toHaveLength(1)
    expect(saved[0]!.settings).toEqual(scene().settings)
    fireEvent.click(screen.getByRole('button', { name: 'Play crash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'High: mushy' }))
    expect(scene().settings).toEqual(
      GUMMY_BUILTIN_PRESETS.find((item) => item.id === 'high')!.preset.settings,
    )
    expect(scene().resetKey).toBe(1)
    expect(scene().crashKey).toBe(1)
    expect(scene().paused).toBe(false)
    expect(loadGummyPresets().presets).toEqual(saved)
    fireEvent.change(screen.getByRole('combobox', { name: 'Saved preset' }), {
      target: { value: 'Board take' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }))
    expect(scene().settings).toEqual(saved[0]!.settings)
    expect(scene().resetKey).toBe(2)
  })

  it('changes material parameters live, while material and pin changes reset the board', () => {
    render(() => <GummyBoardPage />)
    fireEvent.click(screen.getByText('Fine tuning'))
    for (const [name, value] of [
      [/Softness/, '0.3'],
      [/Fragility/, '42'],
      [/Flow/, '0.2'],
      [/Grab radius/, '0.14'],
      [/Impact/, '1.3'],
    ] as const)
      fireEvent.input(screen.getByRole('slider', { name }), {
        target: { value },
      })
    fireEvent.change(screen.getByRole('combobox', { name: 'Base palette' }), {
      target: { value: 'lagoon' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow tearing' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Floor caustics' }))
    expect(scene().settings).toMatchObject({
      softness: 0.3,
      fragility: 0.42,
      palette: 'lagoon',
      tearing: false,
      caustics: false,
      tuning: { flow: 0.2 },
      grabRadius: 0.14,
    })
    expect(scene().impact).toBe(1.3)
    expect(scene().resetKey).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Elastic jelly' }))
    expect(scene().settings.particleMaterial).toBe('elastic')
    expect(scene().settings.tuning.flow).toBe(0.2)
    expect(scene().resetKey).toBe(1)
    expect(screen.queryByRole('slider', { name: /Flow/ })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /Pin base to floor/ }))
    expect(scene().settings.pinnedFeet).toBe(false)
    expect(scene().resetKey).toBe(2)
  })

  it('changes camera controls without resetting and accepts scene keyboard callbacks', () => {
    render(() => <GummyBoardPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Close view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Grab pawn' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(scene().view).toBe('close')
    expect(scene().mode).toBe('drag')
    expect(scene().resetViewKey).toBe(1)
    expect(scene().resetKey).toBe(0)
    scene().onPauseChange?.(true)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
    scene().onReplay?.()
    expect(scene().crashKey).toBe(1)
    expect(scene().paused).toBe(false)
    scene().onReset?.()
    expect(scene().resetKey).toBe(1)
  })

  it('records the board canvas before play and keeps that take through replay', () => {
    render(() => <GummyBoardPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(stubs.start).toHaveBeenCalledWith(
      screen.getByTestId('gummy-board-canvas'),
      expect.any(Object),
    )
    expect(scene().recording).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Play crash' }))
    expect(stubs.stop).not.toHaveBeenCalled()
    expect(scene().recording).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(stubs.stop).toHaveBeenCalledTimes(1)
    const blob = new Blob(['clip'], { type: 'video/mp4' })
    stubs.recording!.onComplete({ blob, extension: 'mp4', durationSeconds: 8 })
    expect(scene().recording).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Download video' }))
    expect(stubs.download).toHaveBeenCalledWith(
      blob,
      expect.stringMatching(/^gummy-.*\.mp4$/),
    )
  })

  it('finishes recording when applying a different material and shows a copyable canvas error', () => {
    render(() => <GummyBoardPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }))
    fireEvent.click(screen.getByRole('button', { name: 'Low: firm' }))
    expect(stubs.stop).toHaveBeenCalledWith(
      'Recording finished because the material changed.',
    )
    scene().onError?.('GPU validation error: example pipeline')
    expect(screen.getByRole('alert').textContent).toContain('example pipeline')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Play crash' })
        .disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Simulation error' }))
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: 'Simulation error log',
      }).value,
    ).toBe('GPU validation error: example pipeline')
    fireEvent.click(screen.getByRole('button', { name: 'Reset board' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps playback and recording disabled until the scene is ready', () => {
    stubs.holdReady = true
    render(() => <GummyBoardPage />)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Play crash' })
        .disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Record',
      }).disabled,
    ).toBe(true)
    scene().onReady?.(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Play crash' })
        .disabled,
    ).toBe(false)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Record',
      }).disabled,
    ).toBe(false)
  })
})

describe('GummyBearApp board route', () => {
  it('mounts the board only for view=board', () => {
    window.history.replaceState(null, '', '?view=board')
    render(() => <GummyBearApp />)
    expect(screen.getByTestId('gummy-board-canvas')).toBeTruthy()
    expect(screen.queryByTestId('gummy-workbench')).toBeNull()
  })

  it.each([
    '?experiment=mpm&shape=pawn',
    '?experiment=particle',
    '?experiment=jelly',
    '?view=unknown',
  ])('preserves the workbench at %s', (query) => {
    window.history.replaceState(null, '', query)
    render(() => <GummyBearApp />)
    expect(screen.getByTestId('gummy-workbench')).toBeTruthy()
    expect(screen.queryByTestId('gummy-board-canvas')).toBeNull()
  })
})
