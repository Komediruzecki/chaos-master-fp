/** Own native shot replacement, recording and automation without letting stale callbacks revive a take. */
import { createMemo, createSignal, onCleanup } from 'solid-js'
import { useGummyRecording } from '../GummyBear/useGummyRecording'
import { parseNativeCinemaRecipe } from './nativeCinemaRecipe'
import { saveNativeCinemaRecipe } from './nativeCinemaSession'
import type { NativeCinemaRecipe } from './nativeCinemaRecipe'
import type { NativeFractalCinemaController } from '@/components/FractalCollection/NativeFractalCinemaScene'

export function useNativeCinemaStudio(initial: {
  recipe?: NativeCinemaRecipe
  error?: string
}) {
  const [recipe, setRecipe] = createSignal(initial.recipe)
  const [draft, setDraft] = createSignal(initial.recipe)
  const [ready, setReady] = createSignal(false)
  const [playing, setPlaying] = createSignal(false)
  const [time, setTime] = createSignal(0)
  const [error, setError] = createSignal(initial.error)
  const [exportBusy, setExportBusy] = createSignal(false)
  const [starting, setStarting] = createSignal(false)
  const recording = useGummyRecording('fractal-chess')
  const busy = createMemo(() => exportBusy() || starting() || recording.busy())
  let controller: NativeFractalCinemaController | undefined
  let disposed = false
  let pending:
    | {
        resolve(): void
        reject(error: Error): void
        timer: ReturnType<typeof setTimeout>
      }
    | undefined
  let debug: Window['__nativeChessCinema']

  function rejectPending(message: string) {
    if (!pending) return
    clearTimeout(pending.timer)
    pending.reject(new Error(message))
    pending = undefined
  }

  function apply(value: unknown, configuring = false) {
    if (disposed) throw new Error('Shot studio closed.')
    if (busy())
      throw new Error('Finish recording or exporting before changing the shot.')
    const next = parseNativeCinemaRecipe(value)
    if (!configuring) rejectPending('A newer shot replaced this request.')
    controller?.pause()
    setReady(false)
    setPlaying(false)
    setTime(0)
    setError(undefined)
    setDraft(next)
    setRecipe(next)
    try {
      saveNativeCinemaRecipe(next)
    } catch {
      setError(
        'The shot is ready, but this browser could not save it. Copy its recipe before leaving.',
      )
    }
  }

  function configure(value: unknown) {
    return new Promise<void>((resolve, reject) => {
      try {
        if (disposed) throw new Error('Shot studio closed.')
        if (busy())
          throw new Error(
            'Finish recording or exporting before changing the shot.',
          )
        const next = parseNativeCinemaRecipe(value)
        rejectPending('A newer shot replaced this request.')
        pending = {
          resolve,
          reject,
          timer: setTimeout(() => {
            rejectPending('Shot preparation timed out.')
          }, 60000),
        }
        apply(next, true)
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  }

  function receiveController(next: NativeFractalCinemaController | undefined) {
    controller = next
    if (window.__nativeChessCinema === debug) delete window.__nativeChessCinema
    debug = next ? { ...next, configure, recipe: () => recipe()! } : undefined
    if (import.meta.env.DEV && debug) window.__nativeChessCinema = debug
  }

  function receiveReady(value: boolean) {
    setReady(value)
    if (value && pending) {
      clearTimeout(pending.timer)
      pending.resolve()
      pending = undefined
    }
  }

  function receiveError(message: string) {
    setReady(false)
    setPlaying(false)
    setError(message)
    recording.stop('The GPU stopped this shot.')
    rejectPending(message)
  }

  function guarded(action: () => unknown) {
    try {
      void Promise.resolve(action()).catch((cause: unknown) => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : String(cause))
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function startRecording(canvas: HTMLCanvasElement | null | undefined) {
    if (busy() || !ready() || !controller) return
    const source = controller
    setStarting(true)
    guarded(async () => {
      try {
        await source.resetPaused()
        if (disposed || controller !== source || !ready()) return
        recording.start(canvas)
        if (recording.state() === 'recording') source.play()
      } finally {
        if (!disposed) setStarting(false)
      }
    })
  }
  onCleanup(() => {
    disposed = true
    rejectPending('Shot studio closed.')
    if (window.__nativeChessCinema === debug) delete window.__nativeChessCinema
  })
  return {
    recipe,
    draft,
    setDraft,
    ready,
    playing,
    time,
    error,
    busy,
    recording,
    exportBusy,
    setExportBusy,
    starting,
    apply,
    guarded,
    receiveController,
    receiveReady,
    receiveError,
    controller: () => controller,
    startRecording,
    onProgress: (seconds: number, running: boolean) => {
      setTime(seconds)
      setPlaying(running)
      if (seconds >= (controller?.info().displayDuration ?? 6))
        recording.stop('Shot complete.')
    },
    reset: () => {
      recording.stop('Shot reset.')
      return controller?.resetPaused()
    },
  }
}

declare global {
  interface Window {
    __nativeChessCinema?: NativeFractalCinemaController & {
      configure(value: unknown): Promise<void>
      recipe(): NativeCinemaRecipe
    }
  }
}
