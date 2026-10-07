/** Fixed-resolution MP4 export controls, separate from the interactive live recorder. */
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { downloadBlob } from '@/utils/blob'
import { exportGummyCinema, gummyCinemaExportPlan, supportsGummyCinemaExport, } from './gummyCinemaExport'
import styles from './GummyCinemaExport.module.css'
import type { GummyCinemaExportSettings } from './gummyCinemaExport'
import type { GummyCinemaController } from '@/components/GummyBoard/GummyCinemaScene'

export function GummyCinemaExport(props: {
  controller: () => GummyCinemaController | undefined
  ready: boolean
  disabled: boolean
  portrait: boolean
  onBusy: (busy: boolean) => void
}) {
  const [resolution, setResolution] =
    createSignal<GummyCinemaExportSettings['resolution']>(1080)
  const [fps, setFps] = createSignal<GummyCinemaExportSettings['fps']>(60)
  const [supported, setSupported] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [progress, setProgress] = createSignal(0)
  const [status, setStatus] = createSignal('')
  const [error, setError] = createSignal(false)
  const [clip, setClip] = createSignal<{
    blob: Blob
    filename: string
    description: string
  }>()
  let abort: AbortController | undefined
  let disposed = false
  const plan = () =>
    gummyCinemaExportPlan({
      resolution: resolution(),
      fps: fps(),
      portrait: props.portrait,
    })

  onMount(() => setSupported(supportsGummyCinemaExport()))
  onCleanup(() => {
    disposed = true
    abort?.abort()
    props.onBusy(false)
  })

  async function start() {
    if (busy() || props.disabled || !props.ready) return
    const controller = props.controller()
    if (!controller) return
    abort = new AbortController()
    const operation = abort
    setBusy(true)
    props.onBusy(true)
    setError(false)
    setProgress(0)
    setStatus('Preparing video…')
    let timedOut = false
    let leftTab = false
    const timeout = setTimeout(
      () => {
        timedOut = true
        operation.abort()
      },
      10 * 60 * 1000,
    )
    const onVisibility = () => {
      if (document.hidden) {
        leftTab = true
        operation.abort()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    try {
      const result = await exportGummyCinema({
        controller,
        settings: {
          resolution: resolution(),
          fps: fps(),
          portrait: props.portrait,
        },
        signal: operation.signal,
        onProgress: (frames, total) => {
          if (disposed) return
          setProgress(frames / total)
          setStatus(
            frames === total
              ? 'Finishing MP4…'
              : `Rendering frame ${frames} of ${total}…`,
          )
        },
      })
      if (disposed) return
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      setClip({
        blob: result.blob,
        filename: `gummy-cinema-${result.width}x${result.height}-${result.fps}fps-${timestamp}.mp4`,
        description: `${result.width} × ${result.height} · ${result.fps} fps · ${result.durationSeconds.toFixed(1)} s · ${(result.blob.size / 1024 / 1024).toFixed(1)} MB`,
      })
      setStatus('MP4 ready. Every frame rendered.')
    } catch (failure) {
      if (disposed) return
      setError(!operation.signal.aborted || timedOut)
      setStatus(
        timedOut
          ? 'Export timed out. Try 720p or 30 fps.'
          : leftTab
            ? 'Export cancelled when you left this tab.'
            : operation.signal.aborted
              ? clip()
                ? 'Export cancelled. Your previous video is still available.'
                : 'Export cancelled.'
              : failure instanceof Error
                ? failure.message
                : 'Video export failed. Try a smaller size.',
      )
    } finally {
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', onVisibility)
      if (!disposed) {
        setBusy(false)
        props.onBusy(false)
      }
      abort = undefined
    }
  }

  return (
    <div class={styles.export}>
      <p class={styles.help}>
        Render the whole shot at a fixed size. Slower devices take longer, but
        keep every frame. Uses the applied render quality. Canvas only, no
        audio.
      </p>
      <fieldset class={styles.settings} disabled={busy() || props.disabled}>
        <label for="cinema-export-resolution">Video size</label>
        <select
          id="cinema-export-resolution"
          value={resolution()}
          onChange={(e) =>
            setResolution(
              Number(
                e.currentTarget.value,
              ) as GummyCinemaExportSettings['resolution'],
            )
          }
        >
          <option value="720">720p</option>
          <option value="1080">1080p</option>
          <option value="2160">4K (uses more memory)</option>
        </select>
        <label for="cinema-export-fps">Frame rate</label>
        <select
          id="cinema-export-fps"
          value={fps()}
          onChange={(e) =>
            setFps(
              Number(e.currentTarget.value) as GummyCinemaExportSettings['fps'],
            )
          }
        >
          <option value="30">30 fps</option>
          <option value="60">60 fps</option>
        </select>
      </fieldset>
      <p class={styles.help}>
        {plan().width} × {plan().height} · {fps()} fps · MP4
      </p>
      <button
        class={styles.primary}
        type="button"
        disabled={!busy() && (!props.ready || props.disabled || !supported())}
        onClick={() => {
          if (busy()) abort?.abort()
          else void start()
        }}
      >
        {busy() ? 'Cancel export' : 'Export full-quality MP4'}
      </button>
      <Show when={busy()}>
        <progress
          class={styles.progress}
          max="1"
          value={progress()}
          aria-label="Video export progress"
        />
      </Show>
      <p
        class={styles.status}
        role="status"
        aria-live="polite"
        data-error={error()}
      >
        {status() ||
          (!supported()
            ? 'Frame-by-frame export is unavailable here. You can still use Record above.'
            : 'Keep this tab open while exporting.')}
      </p>
      <Show when={clip()}>
        {(saved) => (
          <div class={styles.saved}>
            <button
              class={styles.secondary}
              type="button"
              disabled={busy() || props.disabled}
              onClick={() => {
                downloadBlob(saved().blob, saved().filename)
              }}
            >
              Download MP4
            </button>
            <span>{saved().description}</span>
          </div>
        )}
      </Show>
    </div>
  )
}
