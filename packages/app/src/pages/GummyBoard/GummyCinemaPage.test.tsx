/** Draft edits, portable recipes and recording must preserve the running cinema scene until Apply. */
import { cleanup, fireEvent, render, screen, waitFor, } from '@solidjs/testing-library'
import { onCleanup } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUMMY_BOARD_SHOTS } from '@/components/GummyBoard/gummyBoardShots'
import { createGummyCaptureMechanic, gummyCaptureMechanicContext, } from '@/components/GummyBoard/gummyCaptureMechanics'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
import { GummyCinemaPage } from './GummyCinemaPage'
import { createGummyCinemaRecipe, parseGummyCinemaRecipe, } from './gummyCinemaRecipe'
import { GUMMY_MATCH_CINEMA_KEY } from './gummyMatchSession'
import type { ComponentProps } from 'solid-js'
import type { GummyCinemaController, GummyCinemaScene, } from '@/components/GummyBoard/GummyCinemaScene'
import type { LiveCanvasRecordingOptions } from '@/utils/liveCanvasRecorder'

type SceneProps = ComponentProps<typeof GummyCinemaScene>
const fixtures = vi.hoisted(() => ({
  scenes: [] as SceneProps[],
  holdReady: false,
  order: [] as string[],
  pause: vi.fn(),
  reset: vi.fn(),
  resetPending: undefined as Promise<void> | undefined,
  play: vi.fn(),
  seek: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  disposeRecording: vi.fn(),
  recording: undefined as LiveCanvasRecordingOptions | undefined,
  exportControls: [] as {
    onBusy: (busy: boolean) => void
    disabled: boolean
  }[],
}))

vi.mock('@/components/GummyBoard/GummyCinemaScene', () => ({
  GummyCinemaScene: (props: SceneProps) => {
    fixtures.scenes.push(props)
    const controller: GummyCinemaController = {
      info: () => ({
        ready: true,
        shotId: props.shot.id,
        config: props.shot,
        displayDuration: 8,
        displayTime: 0,
        simulationTime: 0,
        phase: 'ready',
        scale: props.scale,
        artStyle: props.artStyle,
        quality: props.quality,
        material: props.material,
        attackerPalette: props.attackerPalette,
        victimPalette: props.victimPalette,
      }),
      play() {
        fixtures.order.push('play')
        fixtures.play()
        props.onProgress(0, true)
      },
      pause() {
        fixtures.pause()
        props.onProgress(0, false)
      },
      resetPaused() {
        fixtures.order.push('reset')
        fixtures.reset()
        props.onProgress(0, false)
        return fixtures.resetPending ?? Promise.resolve()
      },
      seekFrame(frame, fps = 60) {
        fixtures.seek(frame, fps)
        props.onProgress(frame / fps, false)
        return Promise.resolve()
      },
      render: () => Promise.resolve(),
      setCaptureSize: () => Promise.resolve(),
      captureFrame: () =>
        Promise.reject(new Error('Native export is mocked in this page test.')),
      readState: () =>
        Promise.reject(new Error('The page test does not read GPU state.')),
      readSurfaceStats: () =>
        Promise.reject(new Error('The page test does not read GPU surfaces.')),
      readRenderStats: () => {
        throw new Error('The page test does not read renderer statistics.')
      },
    }
    props.onController(controller)
    if (!fixtures.holdReady) props.onReady(true)
    onCleanup(() => {
      props.onController(undefined)
    })
    return <canvas data-testid="gummy-cinema-canvas" />
  },
}))
vi.mock('./GummyCinemaExport', () => ({
  GummyCinemaExport: (props: {
    onBusy: (busy: boolean) => void
    disabled: boolean
  }) => {
    fixtures.exportControls.push(props)
    return <div data-testid="native-cinema-export" />
  },
}))
vi.mock('@/utils/liveCanvasRecorder', () => ({
  supportsLiveCanvasRecording: () => true,
  startLiveCanvasRecording: fixtures.startRecording,
}))

let oldUrl: string
beforeEach(() => {
  oldUrl = window.location.href
  window.history.replaceState(null, '', '/gummy?view=cinema')
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  const session = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => {
      session.set(key, value)
    },
    removeItem: (key: string) => {
      session.delete(key)
    },
  })
  fixtures.scenes.length = 0
  fixtures.order.length = 0
  fixtures.exportControls.length = 0
  fixtures.holdReady = false
  fixtures.resetPending = undefined
  fixtures.recording = undefined
  vi.clearAllMocks()
  fixtures.startRecording.mockImplementation(
    (_canvas: HTMLCanvasElement, callbacks: LiveCanvasRecordingOptions) => {
      fixtures.order.push('record')
      fixtures.recording = callbacks
      return {
        stop: fixtures.stopRecording,
        dispose: fixtures.disposeRecording,
      }
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', oldUrl)
})
const current = () => fixtures.scenes.at(-1)!
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: label }), {
    target: { value },
  })
const apply = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Apply shot settings' }))

function openSection(title: string) {
  const summary = screen.getByText(title).closest('summary')!
  if (!summary.parentElement!.hasAttribute('open')) fireEvent.click(summary)
}

function exportRecipe() {
  openSection('Share this shot')
  fireEvent.click(screen.getByRole('button', { name: 'Show recipe JSON' }))
  return parseGummyCinemaRecipe(
    screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Shot recipe JSON',
    }).value,
  )
}

describe('GummyCinemaPage', () => {
  it('opens a validated match handoff and preserves the same shot after a reload', () => {
    const recipe = createGummyCinemaRecipe(GUMMY_BOARD_SHOTS[1])
    recipe.shot.id = 'match-capture-7'
    recipe.scale = 0.94
    recipe.material.softness = 0.35
    window.history.replaceState(null, '', '/gummy?view=cinema&from=match')
    sessionStorage.setItem(GUMMY_MATCH_CINEMA_KEY, JSON.stringify(recipe))
    const view = render(() => <GummyCinemaPage />)
    expect(fixtures.scenes.at(-1)?.shot).toEqual(recipe.shot)
    expect(fixtures.scenes.at(-1)?.material.softness).toBe(0.35)
    expect(fixtures.scenes.at(-1)?.scale).toBe(0.94)
    expect(
      screen
        .getByRole('link', { name: 'Play gummy chess' })
        .getAttribute('href'),
    ).toBe('/gummy?view=match')
    view.unmount()
    render(() => <GummyCinemaPage />)
    expect(fixtures.scenes.at(-1)?.shot.id).toBe('match-capture-7')
  })

  it('loads a named shot with its exact RockGummy material and keeps the three independent shots available', () => {
    window.history.replaceState(null, '', '/gummy?view=cinema&shot=bishop-rook')
    render(() => <GummyCinemaPage />)
    const rock = GUMMY_BUILTIN_PRESETS.find((p) => p.id === 'rockgummy')!.preset
      .settings
    expect(current().shot.id).toBe('bishop-rook')
    expect(current().material).toEqual(rock)
    expect(current().material).not.toBe(rock)
    expect(current().material.tuning).not.toBe(rock.tuning)
    expect(current().artStyle).toBe('sculpted')
    for (const shot of GUMMY_BOARD_SHOTS)
      expect(
        screen
          .getByRole('button', { name: shot.title })
          .getAttribute('aria-pressed'),
      ).toBe(String(shot.id === 'bishop-rook'))
    expect(exportRecipe().material).toEqual(rock)
  })

  it('stages appearance, camera and material changes until Apply replaces the scene once', () => {
    render(() => <GummyCinemaPage />)
    const before = current()
    change('Piece design', 'classic')
    change('Board finish', 'lava')
    openSection('Camera and quality')
    change('Camera movement', 'hero')
    change('Render quality', 'tablet')
    change('Attacking piece color', 'candy')
    change('Captured piece color', 'berry')
    change('Material', 'rockgummy')
    fireEvent.input(screen.getByRole('slider', { name: /Piece size/ }), {
      target: { value: '0.95' },
    })
    expect(fixtures.scenes).toHaveLength(1)
    expect(current()).toBe(before)
    expect(current().shot.boardTheme).toBe('classic')
    expect(exportRecipe().shot.boardTheme).toBe('classic')
    expect(fixtures.pause).not.toHaveBeenCalled()
    apply()
    expect(fixtures.scenes).toHaveLength(2)
    expect(fixtures.pause).toHaveBeenCalledTimes(1)
    expect(current()).toMatchObject({
      artStyle: 'classic',
      scale: 0.95,
      quality: 'tablet',
      attackerPalette: 'candy',
      victimPalette: 'berry',
    })
    expect(current().shot).toMatchObject({
      boardTheme: 'lava',
      cameraStyle: 'hero',
      presetId: 'rockgummy',
    })
    expect(current().material).toEqual(
      GUMMY_BUILTIN_PRESETS.find((p) => p.id === 'rockgummy')!.preset.settings,
    )
  })

  it('offers press and peel before advanced controls and stages it independently of material', () => {
    render(() => <GummyCinemaPage />)
    const material = structuredClone(current().material)
    expect(current().shot.motion).toEqual({
      shearOnset: 1,
      shearDistance: 0.18,
      contactHold: 0,
    })
    const peel = screen.getByRole('button', { name: 'Press and peel' })
    expect(peel.closest('details')?.querySelector('summary')?.textContent).toBe(
      'Capture motion',
    )
    expect(peel.closest('details')?.open).toBe(true)
    fireEvent.click(peel)
    fireEvent.click(screen.getByText('Crush and shear'))
    expect(
      screen.getByRole<HTMLInputElement>('slider', { name: /Shear onset/ })
        .value,
    ).toBe('0.35')
    expect(
      screen.getByRole<HTMLInputElement>('slider', { name: /Sideways travel/ })
        .value,
    ).toBe('1.1')
    expect(
      screen.getByRole<HTMLInputElement>('slider', { name: /Mid-press hold/ })
        .value,
    ).toBe('0.35')
    fireEvent.input(screen.getByRole('slider', { name: /Sideways travel/ }), {
      target: { value: '0.42' },
    })
    fireEvent.input(screen.getByRole('slider', { name: /Mid-press hold/ }), {
      target: { value: '0.35' },
    })
    expect(fixtures.scenes).toHaveLength(1)
    expect(exportRecipe().shot.motion).toEqual({
      shearOnset: 1,
      shearDistance: 0.18,
      contactHold: 0,
    })
    apply()
    expect(current().shot.motion).toEqual({
      shearOnset: 0.35,
      shearDistance: 0.42,
      contactHold: 0.35,
    })
    expect(current().material).toEqual(material)
    expect(exportRecipe()).toMatchObject({
      version: 3,
      shot: {
        motion: { shearOnset: 0.35, shearDistance: 0.42, contactHold: 0.35 },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Original motion' }))
    apply()
    expect(current().shot.motion).toEqual({
      shearOnset: 1,
      shearDistance: 0.18,
      contactHold: 0,
    })
    expect(current().material).toEqual(material)
  })

  it.each([
    ['press-settle', 'Press and settle'],
    ['shoulder-sweep', 'Shoulder sweep'],
    ['rock-shear', 'Rock and shear'],
  ] as const)(
    'stages the fixed %s mechanic and exports its exact motion without changing material',
    (id, title) => {
      render(() => <GummyCinemaPage />)
      const before = current()
      const material = structuredClone(before.material)
      const selected = createGummyCaptureMechanic(
        id,
        0,
        gummyCaptureMechanicContext(before.shot, before.scale),
      )
      const button = screen.getByRole('button', { name: title })
      fireEvent.click(button)
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(fixtures.scenes).toHaveLength(1)
      expect(current()).toBe(before)
      apply()
      expect(fixtures.scenes).toHaveLength(2)
      expect(current().shot.mechanic).toEqual(selected.mechanic)
      expect(current().shot.motion).toEqual(selected.motion)
      expect(current().material).toEqual(material)
      const exported = exportRecipe()
      expect(exported.version).toBe(3)
      expect(exported.shot.mechanic).toEqual(selected.mechanic)
      expect(exported.shot.motion).toEqual(selected.motion)
      fireEvent.click(screen.getByRole('button', { name: 'Play shot' }))
      expect(current().shot.motion).toEqual(selected.motion)
      expect(fixtures.scenes).toHaveLength(2)
    },
  )

  it('keeps the imported seed for fixed choices and clears provenance when tuning motion', () => {
    const recipe = createGummyCinemaRecipe()
    const selected = createGummyCaptureMechanic(
      'rock-shear',
      73,
      gummyCaptureMechanicContext(recipe.shot, recipe.scale),
    )
    recipe.shot = { ...recipe.shot, ...selected }
    sessionStorage.setItem(GUMMY_MATCH_CINEMA_KEY, JSON.stringify(recipe))
    window.history.replaceState(null, '', '/gummy?view=cinema&from=match')
    render(() => <GummyCinemaPage />)
    expect(
      screen
        .getByRole('button', { name: 'Rock and shear' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Shoulder sweep' }))
    apply()
    expect(current().shot.mechanic?.seed).toBe(73)
    fireEvent.click(screen.getByRole('button', { name: 'Rock and shear' }))
    apply()
    openSection('Crush and shear')
    fireEvent.input(screen.getByRole('slider', { name: /Sideways travel/ }), {
      target: { value: '0.42' },
    })
    expect(
      screen
        .getByRole('button', { name: 'Rock and shear' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    expect(
      screen.getByText(/Custom motion. The recipe keeps your exact settings/),
    ).toBeTruthy()
    apply()
    expect(current().shot.mechanic).toBeUndefined()
    expect(current().shot.motion).toEqual({
      ...selected.motion,
      shearDistance: 0.42,
    })
    expect(exportRecipe().shot.motion).toEqual({
      ...selected.motion,
      shearDistance: 0.42,
    })
  })

  it('rebinds fixed motion when draft size or position changes and keeps the live scene until Apply', () => {
    const recipe = createGummyCinemaRecipe()
    recipe.shot.fen = '7k/8/8/3n4/4P3/8/8/K7 w - - 0 1'
    Object.assign(recipe.shot, createGummyCaptureMechanic('rock-shear', 73))
    recipe.shot.motion.shearDistance = 0.29
    sessionStorage.setItem(GUMMY_MATCH_CINEMA_KEY, JSON.stringify(recipe))
    window.history.replaceState(null, '', '/gummy?view=cinema&from=match')
    render(() => <GummyCinemaPage />)
    const before = current()
    expect(before.shot.motion.shearDistance).toBe(0.29)
    openSection('Position and move')
    fireEvent.input(screen.getByLabelText('Position (FEN)'), {
      target: { value: '' },
    })
    apply()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(current()).toBe(before)
    fireEvent.input(screen.getByLabelText('Position (FEN)'), {
      target: { value: GUMMY_BOARD_SHOTS[0]!.fen },
    })
    fireEvent.input(screen.getByRole('slider', { name: /Piece size/ }), {
      target: { value: '1' },
    })
    expect(fixtures.scenes).toHaveLength(1)
    apply()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(current().shot.mechanic).toEqual(recipe.shot.mechanic)
    expect(current().shot.motion).toEqual(
      createGummyCaptureMechanic(
        'rock-shear',
        73,
        gummyCaptureMechanicContext(current().shot, current().scale),
      ).motion,
    )
    expect(current().shot.motion.shearDistance).toBeLessThan(0.29)
    expect(current().material).toEqual(before.material)
    expect(exportRecipe().shot.motion).toEqual(current().shot.motion)
  })

  it.each(['position', 'capture'] as const)(
    'keeps the active shot playable after an invalid %s draft',
    (kind) => {
      render(() => <GummyCinemaPage />)
      const before = current()
      fireEvent.click(screen.getByText('Position and move'))
      const input = screen.getByLabelText(
        kind === 'position' ? 'Position (FEN)' : 'Capture target square',
      )
      fireEvent.input(input, {
        target: {
          value: kind === 'position' ? '8/8/8/8/8/8/8/8 w - - 0 1' : 'e5',
        },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Shoulder sweep' }))
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(fixtures.scenes).toHaveLength(1)
      apply()
      expect(screen.getByRole('alert').textContent).toMatch(
        kind === 'position' ? /king/ : /occupied destination/,
      )
      expect(fixtures.scenes).toHaveLength(1)
      expect(current()).toBe(before)
      expect(fixtures.pause).not.toHaveBeenCalled()
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Play shot' })
          .disabled,
      ).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: 'Play shot' }))
      expect(fixtures.play).toHaveBeenCalledTimes(1)
      fireEvent.input(input, {
        target: {
          value: kind === 'position' ? before.shot.fen : before.shot.to,
        },
      })
      apply()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(fixtures.scenes).toHaveLength(2)
    },
  )

  it('imports and re-exports a complete recipe while rejecting a malformed replacement', () => {
    render(() => <GummyCinemaPage />)
    const recipe = createGummyCinemaRecipe(GUMMY_BOARD_SHOTS[1])
    recipe.scale = 0.95
    recipe.attackerPalette = 'candy'
    recipe.victimPalette = 'amber'
    recipe.material.pinnedFeet = false
    fireEvent.click(screen.getByText('Share this shot'))
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Shot recipe JSON',
    })
    fireEvent.input(textarea, { target: { value: JSON.stringify(recipe) } })
    fireEvent.click(screen.getByRole('button', { name: 'Load recipe' }))
    expect(current().material).toEqual(recipe.material)
    expect(current().shot).toEqual(recipe.shot)
    expect(current().scale).toBe(0.95)
    fireEvent.click(screen.getByRole('button', { name: 'Show recipe JSON' }))
    expect(parseGummyCinemaRecipe(textarea.value)).toEqual(recipe)
    const before = current()
    fireEvent.input(textarea, { target: { value: '{' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load recipe' }))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(current()).toBe(before)
    expect(fixtures.scenes).toHaveLength(2)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Play shot' })
        .disabled,
    ).toBe(false)
  })

  it('preserves the scene and draft while hiding and restoring the controls', () => {
    render(() => <GummyCinemaPage />)
    change('Board finish', 'glass')
    const before = current()
    fireEvent.click(screen.getByRole('button', { name: 'Hide controls' }))
    expect(screen.queryByRole('heading', { name: 'Gummy cinema' })).toBeNull()
    expect(screen.getByTestId('gummy-cinema-canvas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show controls' }))
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Board finish' })
        .value,
    ).toBe('glass')
    expect(current()).toBe(before)
    expect(fixtures.scenes).toHaveLength(1)
  })

  it('copies the visible recipe with an icon and confirms success without applying staged edits', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(() => <GummyCinemaPage />)
    change('Board finish', 'lava')
    const exported = exportRecipe()
    const copy = screen.getByRole('button', { name: 'Copy recipe JSON' })
    expect(copy.querySelector('svg')).toBeTruthy()
    fireEvent.click(copy)
    await waitFor(() => {
      expect(screen.getByText('Recipe copied.')).toBeTruthy()
    })
    expect(
      parseGummyCinemaRecipe(writeText.mock.calls[0]![0] as string),
    ).toEqual(exported)
    expect(exported.shot.boardTheme).toBe('classic')
    expect(fixtures.scenes).toHaveLength(1)
    expect(copy.textContent).toBe('Copied')
  })

  it('selects the complete recipe for manual copying when clipboard access is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard blocked'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(() => <GummyCinemaPage />)
    openSection('Share this shot')
    fireEvent.click(screen.getByRole('button', { name: 'Copy recipe JSON' }))
    await waitFor(() => {
      expect(screen.getByText(/Copy was blocked/)).toBeTruthy()
    })
    const text = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Shot recipe JSON',
    })
    expect(document.activeElement).toBe(text)
    expect(text.selectionStart).toBe(0)
    expect(text.selectionEnd).toBe(text.value.length)
    expect(parseGummyCinemaRecipe(text.value).shot.id).toBe(current().shot.id)
    expect(fixtures.scenes).toHaveLength(1)
  })

  it('keeps disclosure and draft state through clean preview, shot changes and applying settings', async () => {
    render(() => <GummyCinemaPage />)
    openSection('Camera and quality')
    openSection('Position and move')
    fireEvent.click(screen.getByText('Pieces and board'))
    await waitFor(() => {
      expect(
        screen.getByText('Pieces and board').closest('details')?.open,
      ).toBe(false)
    })
    change('Camera movement', 'hero')
    fireEvent.click(screen.getByRole('button', { name: 'Hide controls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show controls' }))
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Camera movement',
      }).value,
    ).toBe('hero')
    expect(screen.getByText('Position and move').closest('details')?.open).toBe(
      true,
    )
    expect(screen.getByText('Pieces and board').closest('details')?.open).toBe(
      false,
    )
    apply()
    fireEvent.click(screen.getByRole('button', { name: 'Bishop takes rook' }))
    expect(
      screen.getByText('Camera and quality').closest('details')?.open,
    ).toBe(true)
    expect(screen.getByText('Position and move').closest('details')?.open).toBe(
      true,
    )
    expect(screen.getByText('Pieces and board').closest('details')?.open).toBe(
      false,
    )
    expect(fixtures.exportControls).toHaveLength(1)
  })

  it('locks scene mutations while a native export is busy and preserves it when controls are hidden', () => {
    render(() => <GummyCinemaPage />)
    fixtures.exportControls[0]!.onBusy(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Play shot' })
        .disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Bishop takes rook',
      }).disabled,
    ).toBe(true)
    expect(
      screen
        .getByRole('group', { name: 'Stage the shot' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Record' })
        .disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Hide controls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show controls' }))
    expect(fixtures.exportControls).toHaveLength(1)
    fixtures.exportControls[0]!.onBusy(false)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Play shot' })
        .disabled,
    ).toBe(false)
  })

  it('waits for reset before recording, disables shot edits, and stops on completion', async () => {
    render(() => <GummyCinemaPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(fixtures.order).toEqual(['reset', 'record', 'play'])
    expect(fixtures.startRecording.mock.calls[0]![0]).toBe(
      screen.getByTestId('gummy-cinema-canvas'),
    )
    expect(
      screen
        .getByRole('group', { name: 'Stage the shot' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Bishop takes rook',
      }).disabled,
    ).toBe(true)
    current().onProgress(8, false)
    expect(fixtures.stopRecording).toHaveBeenCalledWith('Shot complete.')
  })

  it('locks both capture paths and scene edits while the live recorder waits for a GPU reset', async () => {
    let finishReset!: () => void
    fixtures.resetPending = new Promise<void>((resolve) => {
      finishReset = resolve
    })
    render(() => <GummyCinemaPage />)
    const record = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Record',
    })
    fireEvent.click(record)
    expect(record.disabled).toBe(true)
    expect(fixtures.exportControls[0]!.disabled).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Play shot' })
        .disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reset' }).disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Bishop takes rook',
      }).disabled,
    ).toBe(true)
    expect(
      screen
        .getByRole('group', { name: 'Stage the shot' })
        .hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(record)
    expect(fixtures.order).toEqual(['reset'])
    finishReset()
    await waitFor(() => {
      expect(fixtures.order).toEqual(['reset', 'record', 'play'])
    })
    expect(fixtures.exportControls[0]!.disabled).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Stop recording' })
        .disabled,
    ).toBe(false)
  })

  it('does not start a recorder for a scene that was replaced during the reset', async () => {
    let finishReset!: () => void
    fixtures.resetPending = new Promise<void>((resolve) => {
      finishReset = resolve
    })
    render(() => <GummyCinemaPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await window.__gummyCinema!.configure(
      createGummyCinemaRecipe(GUMMY_BOARD_SHOTS[1]),
    )
    finishReset()
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Record' })
          .disabled,
      ).toBe(false)
    })
    expect(fixtures.startRecording).not.toHaveBeenCalled()
    expect(fixtures.play).not.toHaveBeenCalled()
    expect(current().shot.id).toBe('bishop-rook')
  })

  it('distinguishes a GPU failure from a draft validation error', () => {
    render(() => <GummyCinemaPage />)
    current().onError('Device lost during the shot.')
    expect(screen.getByRole('alert').textContent).toBe(
      'Device lost during the shot.',
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Play shot' })
        .disabled,
    ).toBe(true)
  })

  it('resolves configure even when the replacement scene reports ready synchronously', async () => {
    render(() => <GummyCinemaPage />)
    const api = window.__gummyCinema!
    await api.configure(createGummyCinemaRecipe(GUMMY_BOARD_SHOTS[2]))
    expect(window.__gummyCinema!.recipe().shot.id).toBe('queen-rook')
    expect(fixtures.scenes).toHaveLength(2)
  })

  it('rejects superseded and closed configure requests without losing the active controller', async () => {
    const mounted = render(() => <GummyCinemaPage />)
    fixtures.holdReady = true
    const api = window.__gummyCinema!
    const first = api
      .configure(createGummyCinemaRecipe(GUMMY_BOARD_SHOTS[1]))
      .then(
        () => 'ready',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      )
    const second = window.__gummyCinema!.configure(
      createGummyCinemaRecipe(GUMMY_BOARD_SHOTS[2]),
    )
    expect(await first).toMatch(/newer shot/)
    current().onReady(true)
    await second
    const third = window
      .__gummyCinema!.configure(createGummyCinemaRecipe())
      .then(
        () => 'ready',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      )
    mounted.unmount()
    expect(await third).toMatch(/closed/)
    expect(window.__gummyCinema).toBeUndefined()
  })
})
