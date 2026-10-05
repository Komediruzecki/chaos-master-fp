/** Own a live canvas take independently of the responsive recording controls. */
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { downloadBlob } from '@/utils/blob'
import { startLiveCanvasRecording, supportsLiveCanvasRecording, } from '@/utils/liveCanvasRecorder'

export function useGummyRecording() {
  const [state, setState] = createSignal<
    'idle' | 'recording' | 'stopping' | 'ready' | 'error'
  >('idle')
  const [supported, setSupported] = createSignal(false)
  const [elapsed, setElapsed] = createSignal(0)
  const [error, setError] = createSignal<string>()
  const [clip, setClip] = createSignal<{
    blob: Blob
    filename: string
    durationSeconds: number
    extension: 'mp4' | 'webm'
    reason?: string
  }>()
  const busy = createMemo(
    () => state() === 'recording' || state() === 'stopping',
  )
  let session: ReturnType<typeof startLiveCanvasRecording> | undefined
  let generation = 0
  let disposed = false
  onMount(() => setSupported(supportsLiveCanvasRecording()))
  onCleanup(() => {
    disposed = true
    generation++
    session?.dispose()
    session = undefined
  })

  function start(canvas: HTMLCanvasElement | null | undefined) {
    if (busy() || disposed) return
    setError(undefined)
    if (!canvas) {
      setError('The canvas is still loading. Try recording again in a moment.')
      setState('error')
      return
    }
    const current = ++generation
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const isCurrent = () => !disposed && current === generation
    try {
      session = startLiveCanvasRecording(canvas, {
        onElapsed: (seconds) => {
          if (isCurrent()) setElapsed(seconds)
        },
        onStopping: () => {
          if (isCurrent()) setState('stopping')
        },
        onComplete: (result) => {
          if (!isCurrent()) return
          session = undefined
          setClip({
            ...result,
            filename: `gummy-${timestamp}.${result.extension}`,
          })
          setElapsed(result.durationSeconds)
          setState('ready')
        },
        onError: (failure) => {
          if (!isCurrent()) return
          session = undefined
          setError(failure.message)
          setState('error')
        },
      })
      setElapsed(0)
      setState('recording')
    } catch (failure) {
      session = undefined
      setError(
        failure instanceof Error
          ? failure.message
          : 'Recording could not start. Try again.',
      )
      setState('error')
    }
  }

  function stop(reason?: string) {
    if (!session || state() !== 'recording') return
    setState('stopping')
    session.stop(reason)
  }

  return {
    state,
    supported,
    elapsed,
    error,
    clip,
    busy,
    start,
    stop,
    download() {
      const saved = clip()
      if (saved && !busy()) downloadBlob(saved.blob, saved.filename)
    },
  }
}

export type GummyRecording = ReturnType<typeof useGummyRecording>
