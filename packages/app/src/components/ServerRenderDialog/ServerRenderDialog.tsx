import { createSignal, Show } from 'solid-js'
import { Button } from '@/components/Button/Button'
import { useRequestModal } from '@/components/Modal/ModalContext'
import { ModalTitleBar } from '@/components/Modal/ModalTitleBar'
import { persistentSignal } from '@/utils/persistentSignal'
import { pollUntilComplete, submitServerRender } from '@/utils/serverRender'
import ui from './ServerRenderDialog.module.css'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { ServerRenderJob } from '@/utils/serverRender'

export function createServerRenderDialog(
  getFlameDescriptor: () => FlameDescriptor,
  getResolution?: () => number,
  getQuality?: () => number,
) {
  const requestModal = useRequestModal()
  const [open, setOpen] = createSignal(false)

  async function show() {
    setOpen(true)

    type RenderPhase = 'config' | 'submitting' | 'rendering' | 'done' | 'error'

    const [serverUrl, setServerUrl] = persistentSignal(
      'server-render/url',
      'http://localhost:8787',
    )
    const [resolution, setResolution] = createSignal(getResolution?.() ?? 1)
    const [quality, setQuality] = createSignal(getQuality?.() ?? 0.5)

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
        const flame = getFlameDescriptor()
        const flameJson = JSON.stringify(flame)
        const width = Math.round(800 * resolution())
        const height = Math.round(800 * resolution())
        const qual = quality()

        const { jobId } = await submitServerRender(serverUrl(), flameJson, {
          width,
          height,
          quality: qual,
        })

        if (signal.aborted) return

        setPhase('rendering')

        const png = await pollUntilComplete(
          serverUrl(),
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
      } catch (e) {
        if (signal.aborted && phase() === 'rendering') return
        setPhase('error')
        setErrorMessage(e instanceof Error ? e.message : String(e))
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
            <Show when={phase() === 'config' || phase() === 'error'}>
              <label class={ui.field}>
                <span>Server URL</span>
                <input
                  type="text"
                  class={ui.urlInput}
                  value={serverUrl()}
                  onInput={(e) => setServerUrl(e.currentTarget.value)}
                  placeholder="http://localhost:8787"
                />
                <span class={ui.serverInfo}>
                  Deno render-worker endpoint. Defaults to localhost.
                </span>
              </label>

              <div class={ui.fieldRow}>
                <label class={ui.field}>
                  <span>Resolution</span>
                  <select
                    class={ui.select}
                    value={resolution()}
                    onChange={(e) =>
                      setResolution(Number(e.currentTarget.value))
                    }
                  >
                    <option value={1}>1x (800px)</option>
                    <option value={2}>2x (1600px)</option>
                    <option value={4}>4x (3200px)</option>
                  </select>
                </label>
                <label class={ui.field}>
                  <span>Quality</span>
                  <select
                    class={ui.select}
                    value={quality()}
                    onChange={(e) => setQuality(Number(e.currentTarget.value))}
                  >
                    <option value={0.1}>Draft (50K)</option>
                    <option value={0.3}>Low (200K)</option>
                    <option value={0.5}>Medium (500K)</option>
                    <option value={0.7}>High (1M)</option>
                    <option value={0.9}>Ultra (2M)</option>
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
              <Button onClick={handleSubmit}>Render on Server</Button>
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
