import { createMemo, createSignal, For, Show } from 'solid-js'
import { Button } from '@/components/Button/Button'
import { useRequestModal } from '@/components/Modal/ModalContext'
import { ModalTitleBar } from '@/components/Modal/ModalTitleBar'
import { useAuth } from '@/contexts/AuthContext'
import { fetchFeatureFlags, pollUntilComplete, submitRender, } from '@/db/services/render-service'
import { IS_DEV } from '@/defaults'
import { cameraFromFlame, creditsForRender, estimateRenderSeconds, qualityPointLimit, } from '@/flame/renderCost'
import { formatPointCount } from '@/utils/formatPointCount'
import ui from './ServerRenderDialog.module.css'
import type { ServerRenderEngine, ServerRenderJob, } from '@/db/services/render-service'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

// Per-engine tier ceilings. The deno numbers are a device limit, not a product
// one: the render worker allocates 16 bytes/pixel and Deno's WebGPU rejects a
// single allocation above ~100MB, so ~3008px (16:9) is as far as it goes at any
// tier. Chrome has no such ceiling, so its numbers are the actual tier policy.
const TIER_MAX_RES: Record<ServerRenderEngine, Record<string, number>> = {
  deno: { free: 1920, premium: 2560, pro: 3008 },
  chrome: { free: 1920, premium: 3840, pro: 7680 },
}

const RESOLUTION_OPTIONS = [
  { label: '1280px (HD)', value: 1280 },
  { label: '1920px (Full HD)', value: 1920 },
  { label: '2560px (1440p)', value: 2560 },
  { label: '3008px (deno max)', value: 3008 },
  { label: '3840px (4K)', value: 3840 },
  { label: '7680px (8K)', value: 7680 },
]

/** The two server renderers. See docs/plans/headless-chrome-renderer-plan.md. */
const ENGINE_OPTIONS: {
  value: ServerRenderEngine
  label: string
  hint: string
}[] = [
  { value: 'deno', label: 'Deno', hint: 'up to 3008px' },
  { value: 'chrome', label: 'Chrome', hint: 'up to 8K' },
]

/** Server quality presets — the SAME values as the in-app quality pills, so
 *  "High" on the server means what "High" means on your canvas. The point
 *  counts they imply depend on resolution AND zoom, so they are shown live in
 *  the estimate rather than baked into these labels. */
const QUALITY_PRESETS = [
  { key: 'low', label: 'Low', value: 0.75 },
  { key: 'mid', label: 'Mid', value: 0.85 },
  { key: 'high', label: 'High', value: 0.95 },
  { key: 'ultra', label: 'Ultra', value: 0.995 },
]

export function createServerRenderDialog(
  getFlameDescriptor: () => FlameDescriptor,
) {
  const requestModal = useRequestModal()
  const auth = useAuth()

  const [open, setOpen] = createSignal(false)

  async function show() {
    setOpen(true)

    type RenderPhase = 'config' | 'submitting' | 'rendering' | 'done' | 'error'

    const [resolution, setResolution] = createSignal(1920)
    const [quality, setQuality] = createSignal(0.95)
    const [backend, setBackend] = createSignal<'gpu' | 'cpu'>('gpu')
    const [engine, setEngine] = createSignal<ServerRenderEngine>('deno')
    // Chrome is only offered where the render endpoint's image ships it;
    // otherwise picking it would just earn a 400 from the submit route.
    const [chromeAvailable, setChromeAvailable] = createSignal(false)
    void fetchFeatureFlags().then((flags) => {
      setChromeAvailable(Boolean(flags.chromeRenderEngine))
    })

    const tier = () => auth.subscription().tier
    const maxResFor = (e: ServerRenderEngine) =>
      IS_DEV ? 7680 : (TIER_MAX_RES[e][tier()] ?? 1920)
    const maxRes = () => maxResFor(engine())
    const resolutionOptions = () =>
      RESOLUTION_OPTIONS.filter((o) => o.value <= maxRes())

    // Switching to a lower-ceilinged engine must not leave an unsubmittable
    // resolution selected. Clamped in the setter rather than an effect: this
    // dialog body runs from an event handler, outside any Solid owner.
    const selectEngine = (next: ServerRenderEngine) => {
      setEngine(next)
      if (resolution() > maxResFor(next)) setResolution(maxResFor(next))
    }

    // Live estimate from the shared cost model — same numbers the server
    // charges, including the camera zoom of the flame being rendered.
    const estimate = createMemo(() => {
      const width = resolution()
      const height = Math.round(width * 0.5625)
      const target = { width, height, quality: quality() }
      const camera = cameraFromFlame(getFlameDescriptor())
      // Same engine the submit will use, so the quote matches the charge —
      // chrome carries ~1.5s more fixed cost, which can tip a cheap render
      // into the next credit.
      const eng = engine()
      return {
        width,
        height,
        points: qualityPointLimit(target, camera),
        seconds: estimateRenderSeconds(target, camera, eng),
        credits: creditsForRender(target, camera, eng),
        zoom: 'zoom' in camera ? camera.zoom : undefined,
      }
    })

    const rendersUsed = () => auth.subscription().rendersThisMonth
    const renderLimit = () => auth.subscription().renderLimitMonthly
    const renderLimitReached = () =>
      !IS_DEV && rendersUsed() >= renderLimit() && tier() === 'free'

    const [phase, setPhase] = createSignal<RenderPhase>('config')
    const [progress, setProgress] = createSignal(0)
    const [errorMessage, setErrorMessage] = createSignal('')
    const [renderTimeMs, setRenderTimeMs] = createSignal<number>()
    const [resultUrl, setResultUrl] = createSignal('')
    const [resultBytes, setResultBytes] = createSignal<Uint8Array>()

    const cleanupResultUrl = () => {
      const url = resultUrl()
      if (url) {
        URL.revokeObjectURL(url)
        setResultUrl('')
      }
    }

    let abortController = new AbortController()

    function cancelRender() {
      abortController.abort()
      abortController = new AbortController()
    }

    async function handleSubmit() {
      cancelRender()
      const signal = abortController.signal

      setPhase('submitting')
      setErrorMessage('')
      setProgress(0)
      setRenderTimeMs(undefined)
      cleanupResultUrl()
      setResultBytes(undefined)

      try {
        if (!auth.isAuthenticated()) {
          throw new Error('You need to log in to render on server.')
        }

        const flame = getFlameDescriptor()
        const flameJson = JSON.stringify(flame)
        const width = resolution()
        const height = Math.round(width * 0.5625)
        const qual = quality()

        const { jobId } = await submitRender(flameJson, {
          width,
          height,
          quality: qual,
          backend: backend(),
          engine: engine(),
        })

        // The submit just debited a credit — reflect it without a reload.
        void auth.refreshSubscription()

        if (signal.aborted) return

        setPhase('rendering')

        const png = await pollUntilComplete(
          jobId,
          (job: ServerRenderJob) => {
            setProgress(job.progress)
            if (job.renderTimeMs) setRenderTimeMs(job.renderTimeMs)
          },
          { signal, timeoutMs: 600_000 },
        )

        const resultBlob = new Blob([png as BlobPart], { type: 'image/png' })
        setResultUrl(URL.createObjectURL(resultBlob))
        setResultBytes(png)
        setPhase('done')
        setProgress(1)
        // Counter (rendersThisMonth) settles server-side on completion.
        void auth.refreshSubscription()
      } catch (e) {
        // A failed render refunds its credit server-side — pick that up too.
        void auth.refreshSubscription()
        if (signal.aborted && phase() === 'rendering') return
        setPhase('error')
        const msg = e instanceof Error ? e.message : String(e)
        if (
          msg.toLowerCase().includes('unauthorized') ||
          msg.toLowerCase().includes('missing authorization') ||
          msg.toLowerCase().includes('token')
        ) {
          setErrorMessage('You need to log in to render on server.')
        } else {
          setErrorMessage(msg)
        }
      }
    }

    function handleDownload() {
      const bytes = resultBytes()
      if (!bytes) return
      const downloadBlob = new Blob([bytes as BlobPart], { type: 'image/png' })
      const url = URL.createObjectURL(downloadBlob)
      const a = window.document.createElement('a')
      a.href = url
      a.download = 'flame-server-render.png'
      a.click()
      setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 1000)
    }

    await requestModal({
      class: ui.container,
      content: ({ respond }) => (
        <>
          <ModalTitleBar
            onClose={() => {
              cancelRender()
              respond()
            }}
          >
            Server Render
          </ModalTitleBar>
          <div class={ui.dialogBody}>
            <Show when={auth.isAuthenticated()}>
              <div class={ui.subscriptionInfo}>
                <span class={ui.tierBadge}>{tier()}</span>
                <span>
                  {auth.subscription().rendersThisMonth}/
                  {auth.subscription().renderLimitMonthly} renders used this
                  month
                </span>
              </div>
            </Show>
            <Show when={!auth.isAuthenticated()}>
              <div class={ui.subscriptionInfo}>
                <span class={ui.tierBadge}>free</span>
                <span>Sign in to track your render usage</span>
              </div>
            </Show>

            <Show when={renderLimitReached()}>
              <div class={ui.upgradeBanner}>
                <span>Monthly render limit reached (5/5).</span>
                <span>
                  Upgrade to Premium for 50 renders/month at up to 4K.
                </span>
              </div>
            </Show>

            <Show when={phase() === 'config' || phase() === 'error'}>
              <div class={ui.fieldRow}>
                <label class={ui.field}>
                  <span>
                    Resolution ({tier()} tier max: {maxRes()}px)
                  </span>
                  <select
                    class={ui.select}
                    value={resolution()}
                    onChange={(e) =>
                      setResolution(Number(e.currentTarget.value))
                    }
                  >
                    {resolutionOptions().map((o) => (
                      <option value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <div class={ui.field}>
                  <span>Quality</span>
                  <div class={ui.presetRow}>
                    <For each={QUALITY_PRESETS}>
                      {(preset) => (
                        <button
                          type="button"
                          class={`${ui.presetPill} ${quality() === preset.value ? ui.presetPillActive : ''}`}
                          onClick={() => setQuality(preset.value)}
                        >
                          {preset.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
                <div class={ui.estimate}>
                  <span class={ui.estimateCredits}>
                    {estimate().credits}{' '}
                    {estimate().credits === 1 ? 'credit' : 'credits'}
                  </span>
                  <span class={ui.estimateDetail}>
                    {estimate().width}x{estimate().height} ·{' '}
                    {formatPointCount(estimate().points)} points · ~
                    {estimate().seconds < 10
                      ? estimate().seconds.toFixed(1)
                      : Math.round(estimate().seconds)}
                    s
                    <Show when={(estimate().zoom ?? 1) !== 1}>
                      {' '}
                      · {(estimate().zoom ?? 1).toFixed(1)}x zoom
                    </Show>
                  </span>
                </div>
                <Show when={chromeAvailable()}>
                  <div class={ui.field}>
                    <span>Renderer</span>
                    <div class={ui.presetRow}>
                      <For each={ENGINE_OPTIONS}>
                        {(option) => (
                          <button
                            type="button"
                            class={`${ui.presetPill} ${engine() === option.value ? ui.presetPillActive : ''}`}
                            onClick={() => {
                              selectEngine(option.value)
                            }}
                            title={`${option.label} — ${option.hint}`}
                          >
                            {option.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
                <label class={ui.field}>
                  <span>Device</span>
                  <select
                    class={ui.select}
                    value={backend()}
                    onChange={(e) =>
                      setBackend(e.currentTarget.value as 'gpu' | 'cpu')
                    }
                  >
                    <option value="gpu">GPU (Server)</option>
                    <option value="cpu">CPU (Software)</option>
                  </select>
                </label>
              </div>
            </Show>

            <Show when={phase() === 'error'}>
              <div class={ui.errorText}>{errorMessage()}</div>
            </Show>

            <Show when={phase() === 'submitting'}>
              <span class={ui.statusText}>Submitting render job...</span>
            </Show>

            <Show when={phase() === 'rendering'}>
              <span class={ui.statusText}>
                Rendering... {Math.round(progress() * 100)}%
              </span>
              <div class={ui.track}>
                <div
                  class={ui.fill}
                  style={{ width: `${Math.round(progress() * 100)}%` }}
                />
              </div>
            </Show>

            <Show when={phase() === 'done'}>
              <div class={ui.resultArea}>
                <img
                  src={resultUrl()}
                  alt="Server rendered result"
                  style={{ 'max-width': '100%', 'border-radius': '4px' }}
                />
                <Show when={renderTimeMs() !== undefined}>
                  <span class={ui.resultInfo}>
                    Rendered in {(renderTimeMs()! / 1000).toFixed(1)}s
                  </span>
                </Show>
              </div>
            </Show>
          </div>

          <footer class={ui.footer}>
            <Show when={phase() === 'done' || phase() === 'error'}>
              <Button onClick={() => setPhase('config')}>New Render</Button>
            </Show>
            <Button
              onClick={() => {
                cancelRender()
                respond()
              }}
            >
              {phase() === 'done' ? 'Close' : 'Cancel'}
            </Button>
            <Show when={phase() === 'done'}>
              <Button onClick={handleDownload}>Download PNG</Button>
            </Show>
            <Show when={phase() === 'config' || phase() === 'error'}>
              <Button onClick={handleSubmit} disabled={renderLimitReached()}>
                {renderLimitReached()
                  ? 'Upgrade to Render'
                  : 'Render on Server'}
              </Button>
            </Show>
          </footer>
        </>
      ),
    })

    setOpen(false)
    cleanupResultUrl()
  }

  return { show, open }
}
