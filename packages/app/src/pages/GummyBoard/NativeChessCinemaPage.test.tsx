/** Native studio handoffs, staged edits and recording retain one legal capture through asynchronous work. */
import { cleanup, fireEvent, render, screen, waitFor, } from '@solidjs/testing-library'
import { createEffect, on, onCleanup } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeChessCinemaPage } from './NativeChessCinemaPage'
import { parseNativeCinemaRecipe } from './nativeCinemaRecipe'
import { NATIVE_CINEMA_KEY } from './nativeCinemaSession'
import type { ComponentProps } from 'solid-js'
import type { NativeFractalCinemaController, NativeFractalCinemaScene, } from '@/components/FractalCollection/NativeFractalCinemaScene'
import type { LiveCanvasRecordingOptions } from '@/utils/liveCanvasRecorder'

type SceneProps = ComponentProps<typeof NativeFractalCinemaScene>
const fixtures = vi.hoisted(() => ({
  scenes: [] as SceneProps[],
  holdReady: false,
  order: [] as string[],
  resetPending: undefined as Promise<void> | undefined,
  seekPending: undefined as Promise<void> | undefined,
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  disposeRecording: vi.fn(),
  recording: undefined as LiveCanvasRecordingOptions | undefined,
  exports: [] as { onBusy(busy: boolean): void; disabled: boolean }[],
}))
vi.mock('@/components/FractalCollection/NativeFractalCinemaScene', () => ({
  NativeFractalCinemaScene: (props: SceneProps) => {
    fixtures.scenes.push(props)
    const controller: NativeFractalCinemaController = {
      info: () => ({
        ready: true,
        displayDuration: 6,
        displayTime: 0,
        shotId: 'test-capture',
      }),
      resetPaused() {
        fixtures.order.push('reset')
        props.onProgress(0, false)
        return fixtures.resetPending ?? Promise.resolve()
      },
      play() {
        fixtures.order.push('play')
        props.onProgress(0, true)
      },
      pause() {
        props.onProgress(0, false)
      },
      seekFrame(frame, fps = 60) {
        props.onProgress(frame / fps, false)
        return fixtures.seekPending ?? Promise.resolve()
      },
      setCaptureSize: () => Promise.resolve(),
      captureFrame: () =>
        Promise.reject(new Error('GPU export is outside this page test.')),
      render: () => Promise.resolve(),
      readState() {
        throw new Error('GPU state is outside this page test.')
      },
    }
    props.onController(controller)
    createEffect(
      on(
        () => props.recipe,
        () => {
          if (!fixtures.holdReady) props.onReady(true)
        },
      ),
    )
    onCleanup(() => {
      props.onController(undefined)
    })
    return <canvas data-testid="native-cinema-canvas" />
  },
}))
vi.mock('./GummyCinemaExport', () => ({
  GummyCinemaExport: (props: {
    onBusy(busy: boolean): void
    disabled: boolean
  }) => {
    fixtures.exports.push(props)
    return <div data-testid="native-export" />
  },
}))
vi.mock('@/utils/liveCanvasRecorder', () => ({
  supportsLiveCanvasRecording: () => true,
  startLiveCanvasRecording: fixtures.startRecording,
}))

let oldUrl: string
beforeEach(() => {
  oldUrl = window.location.href
  window.history.replaceState(null, '', '/gummy?view=cinema&renderer=native')
  const entries = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem(key: string, value: string) {
      entries.set(key, value)
    },
  })
  fixtures.scenes.length = 0
  fixtures.exports.length = 0
  fixtures.order.length = 0
  fixtures.holdReady = false
  fixtures.resetPending = undefined
  fixtures.seekPending = undefined
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', oldUrl)
})

const current = () => fixtures.scenes.at(-1)!
const button = (name: string) =>
  screen.getByRole<HTMLButtonElement>('button', { name })

function change(name: string, value: string) {
  fireEvent.change(screen.getByRole('combobox', { name }), {
    target: { value },
  })
}

function draftRecipe() {
  return parseNativeCinemaRecipe({
    format: 'native-chess-cinema-shot',
    version: 1,
    fen: '1r5k/P7/8/8/8/8/8/7K w - - 0 1',
    from: 'a7',
    to: 'b8',
    promotion: 'knight',
    nativeCollection: { version: 1, id: 'tidal-relics', enclosure: 'pure' },
    scale: 0.95,
    quality: 'fine',
    camera: 'hero',
  })
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value)
}

describe('NativeChessCinemaPage', () => {
  it('reloads the exact legal match recipe without consuming its handoff', () => {
    const recipe = draftRecipe()
    sessionStorage.setItem(NATIVE_CINEMA_KEY, JSON.stringify(recipe))
    window.history.replaceState(
      null,
      '',
      '/gummy?view=cinema&renderer=native&from=match',
    )
    const view = render(() => <NativeChessCinemaPage />)
    expect(current().recipe).toEqual(recipe)
    expect(screen.getByText('Pawn takes rook')).toBeTruthy()
    view.unmount()
    render(() => <NativeChessCinemaPage />)
    expect(current().recipe).toEqual(recipe)
    expect(JSON.parse(sessionStorage.getItem(NATIVE_CINEMA_KEY)!)).toEqual(
      recipe,
    )
  })

  it.each([undefined, '{broken', '{}'])(
    'does not substitute an example for a missing or invalid handoff',
    (raw) => {
      window.history.replaceState(
        null,
        '',
        '/gummy?view=cinema&renderer=native&from=match',
      )
      if (raw !== undefined) sessionStorage.setItem(NATIVE_CINEMA_KEY, raw)
      render(() => <NativeChessCinemaPage />)
      expect(fixtures.scenes).toHaveLength(0)
      expect(screen.queryByTestId('native-cinema-canvas')).toBeNull()
      expect(screen.getByRole('alert').textContent).toContain(
        'Return to the match',
      )
      expect(button('Play shot').disabled).toBe(true)
      fireEvent.click(button('Window rook'))
      expect(fixtures.scenes).toHaveLength(1)
      expect(current().recipe.nativeCollection.id).toBe('lattice-court')
      expect(screen.queryByRole('alert')).toBeNull()
    },
  )

  it('stages collection, enclosure, detail and camera without replacing the active take until Apply', () => {
    render(() => <NativeChessCinemaPage />)
    const before = current()
    change('Collection', 'tidal-relics')
    change('Enclosure', 'pure')
    change('Camera movement', 'hero')
    change('Fractal detail', 'fine')
    fireEvent.input(screen.getByRole('slider', { name: /Piece size/ }), {
      target: { value: '0.95' },
    })
    expect(current()).toBe(before)
    expect(window.__nativeChessCinema!.recipe()).toEqual(before.recipe)
    fireEvent.click(button('Hide controls'))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.getByTestId('native-cinema-canvas')).toBeTruthy()
    fireEvent.click(button('Show controls'))
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Camera movement',
      }).value,
    ).toBe('hero')
    fireEvent.click(button('Apply shot settings'))
    expect(fixtures.scenes).toHaveLength(1)
    expect(current().recipe).toMatchObject({
      nativeCollection: { id: 'tidal-relics', enclosure: 'pure' },
      quality: 'fine',
      camera: 'hero',
      scale: 0.95,
      fen: before.recipe.fen,
      from: before.recipe.from,
      to: before.recipe.to,
    })
    expect(fixtures.exports).toHaveLength(1)
  })

  it.each(['connected', 'contact'] as const)(
    'offers the %s prototype only for a Window rook and preserves it in the copied recipe',
    (mode) => {
      render(() => <NativeChessCinemaPage />)
      const option = () =>
        screen.getByRole<HTMLOptionElement>('option', {
          name:
            mode === 'contact'
              ? 'Connected rook: contact fracture'
              : 'Connected rook: rigid study',
        })
      expect(option().disabled).toBe(true)
      fireEvent.click(button('Window rook'))
      expect(option().disabled).toBe(false)
      change('Breakup', mode)
      expect(current().recipe.fracture).toBeUndefined()
      fireEvent.click(button('Apply shot settings'))
      expect(window.__nativeChessCinema!.recipe().fracture).toBe(mode)
      expect(
        JSON.parse(sessionStorage.getItem(NATIVE_CINEMA_KEY)!).fracture,
      ).toBe(mode)
      change('Enclosure', 'pure')
      fireEvent.click(button('Apply shot settings'))
      expect(current().recipe).toMatchObject({
        fracture: mode,
        nativeCollection: { enclosure: 'pure' },
      })
      change('Collection', 'wild-canopy')
      fireEvent.click(button('Apply shot settings'))
      expect(current().recipe.fracture).toBe('points')
      expect(option().disabled).toBe(true)
      expect(fixtures.scenes).toHaveLength(1)
    },
  )

  it('keeps a valid take playable after a malformed replacement and reports GPU errors separately', async () => {
    render(() => <NativeChessCinemaPage />)
    const api = window.__nativeChessCinema!
    const before = current()
    await expect(
      api.configure({ ...before.recipe, to: 'e5' }),
    ).rejects.toThrow()
    expect(current()).toBe(before)
    expect(button('Play shot').disabled).toBe(false)
    fixtures.holdReady = true
    const pending = api
      .configure(draftRecipe())
      .then(() => 'ready', errorMessage)
    current().onError('Device lost while preparing this shot.')
    expect(await pending).toBe('Device lost while preparing this shot.')
    expect(button('Play shot').disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe(
      'Device lost while preparing this shot.',
    )
  })

  it('ignores an old seek failure after Apply but still reports failures from the current shot', async () => {
    let rejectSeek!: (cause: Error) => void
    fixtures.seekPending = new Promise<void>((_resolve, reject) => {
      rejectSeek = reject
    })
    render(() => <NativeChessCinemaPage />)
    fireEvent.change(screen.getByRole('slider', { name: /Shot time/ }), {
      target: { value: '2' },
    })
    change('Camera movement', 'hero')
    fireEvent.click(button('Apply shot settings'))
    expect(current().recipe.camera).toBe('hero')
    rejectSeek(new Error('The old canvas changed size.'))
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(button('Play shot').disabled).toBe(false)

    fixtures.seekPending = new Promise<void>((_resolve, reject) => {
      rejectSeek = reject
    })
    fireEvent.change(screen.getByRole('slider', { name: /Shot time/ }), {
      target: { value: '3' },
    })
    rejectSeek(new Error('The current canvas changed size.'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'The current canvas changed size.',
      )
    })
  })

  it('keeps the new shot usable and its recipe available when saving is blocked', () => {
    render(() => <NativeChessCinemaPage />)
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota')
    })
    fireEvent.click(button('Split-current bishop'))
    expect(current().recipe.nativeCollection.id).toBe('tidal-relics')
    expect(button('Play shot').disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).toContain('could not save it')
    expect(window.__nativeChessCinema!.recipe()).toEqual(current().recipe)
  })

  it('serializes reset, recorder start and playback, locking mutations while recording', async () => {
    let release!: () => void
    fixtures.resetPending = new Promise<void>((resolve) => {
      release = resolve
    })
    render(() => <NativeChessCinemaPage />)
    const api = window.__nativeChessCinema!
    fireEvent.click(button('Record'))
    expect(fixtures.order).toEqual(['reset'])
    for (const name of [
      'Record',
      'Reset',
      'Play shot',
      'Window rook',
      'Portrait framing',
    ])
      expect(button(name).disabled).toBe(true)
    expect(
      screen.getByRole<HTMLFieldSetElement>('group', {
        name: 'Stage the fractal shot',
      }).disabled,
    ).toBe(true)
    expect(fixtures.exports[0]!.disabled).toBe(true)
    await expect(api.configure(draftRecipe())).rejects.toThrow(
      'Finish recording',
    )
    release()
    await waitFor(() => {
      expect(fixtures.order).toEqual(['reset', 'record', 'play'])
    })
    expect(fixtures.startRecording.mock.calls[0]![0]).toBe(
      screen.getByTestId('native-cinema-canvas'),
    )
    expect(button('Stop recording').disabled).toBe(false)
    expect(button('Window rook').disabled).toBe(true)
    current().onProgress(6, false)
    expect(fixtures.stopRecording).toHaveBeenCalledWith('Shot complete.')
  })

  it('does not start recording or playback after leaving during its reset', async () => {
    let release!: () => void
    fixtures.resetPending = new Promise<void>((resolve) => {
      release = resolve
    })
    const view = render(() => <NativeChessCinemaPage />)
    fireEvent.click(button('Record'))
    view.unmount()
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(fixtures.order).toEqual(['reset'])
    expect(fixtures.startRecording).not.toHaveBeenCalled()
    expect(window.__nativeChessCinema).toBeUndefined()
  })

  it('keeps playback paused when the recorder fails and allows another attempt', async () => {
    fixtures.startRecording.mockImplementation(() => {
      throw new Error('Canvas recording failed.')
    })
    render(() => <NativeChessCinemaPage />)
    fireEvent.click(button('Record'))
    await waitFor(() => {
      expect(screen.getByTestId('gummy-recording-status').textContent).toBe(
        'Canvas recording failed.',
      )
    })
    expect(fixtures.order).toEqual(['reset'])
    expect(button('Record').disabled).toBe(false)
    expect(button('Window rook').disabled).toBe(false)
  })

  it('retains the scene and locks both recording paths during full-quality export', async () => {
    render(() => <NativeChessCinemaPage />)
    const before = current()
    fixtures.exports[0]!.onBusy(true)
    for (const name of [
      'Record',
      'Reset',
      'Play shot',
      'Window rook',
      'Portrait framing',
    ])
      expect(button(name).disabled).toBe(true)
    await expect(
      window.__nativeChessCinema!.configure(draftRecipe()),
    ).rejects.toThrow('exporting')
    fireEvent.click(button('Hide controls'))
    fireEvent.click(button('Show controls'))
    expect(current()).toBe(before)
    expect(fixtures.exports).toHaveLength(1)
    fixtures.exports[0]!.onBusy(false)
    expect(button('Play shot').disabled).toBe(false)
  })

  it('resolves synchronous readiness and rejects superseded or closed configure requests', async () => {
    const view = render(() => <NativeChessCinemaPage />)
    await window.__nativeChessCinema!.configure(draftRecipe())
    expect(current().recipe).toEqual(draftRecipe())
    fixtures.holdReady = true
    const first = window
      .__nativeChessCinema!.configure({ ...draftRecipe(), camera: 'diagonal' })
      .then(() => 'ready', errorMessage)
    const second = window.__nativeChessCinema!.configure({
      ...draftRecipe(),
      camera: 'arc',
    })
    expect(await first).toContain('newer shot')
    current().onReady(true)
    await second
    const third = window
      .__nativeChessCinema!.configure(draftRecipe())
      .then(() => 'ready', errorMessage)
    view.unmount()
    expect(await third).toContain('closed')
    expect(window.__nativeChessCinema).toBeUndefined()
  })

  it('rejects retained automation calls after disposal instead of starting an orphan preparation', async () => {
    vi.useFakeTimers()
    const view = render(() => <NativeChessCinemaPage />)
    const api = window.__nativeChessCinema!
    view.unmount()
    let outcome = 'pending'
    const pending = api.configure(draftRecipe()).then(
      () => {
        outcome = 'ready'
      },
      (error: unknown) => {
        outcome = errorMessage(error)
      },
    )
    await Promise.resolve()
    const immediateOutcome = outcome
    await vi.runAllTimersAsync()
    await pending
    expect(immediateOutcome).toContain('closed')
    expect(fixtures.scenes).toHaveLength(1)
  })
})
