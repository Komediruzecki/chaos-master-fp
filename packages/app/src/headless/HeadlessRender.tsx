import { createSignal, onMount, Show } from 'solid-js'
import { vec2f, vec4f } from 'typegpu/data'
import { Flam3 } from '@/flame/Flam3'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Camera2D } from '@/lib/Camera2D'
import { Root } from '@/lib/Root'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * Headless render surface — the server-side renderer's page.
 *
 * PROOF OF CONCEPT for rendering in headless Chrome (Dawn) instead of Deno.
 * Deno's WebGPU refuses any single buffer above ~36-126MB (machine dependent),
 * which caps server renders below 4K; Chrome allocates 1GB buffers on the same
 * GPU. Rendering here reuses the app's REAL pipeline — built by
 * unplugin-typegpu like production — so there is no runtime WGSL extraction
 * and no client/server shader drift.
 *
 * Contract with the driver (workers/render-worker/tools/chrome-render.mjs):
 *   in:  window.__renderJob = { flame, width, height, quality }
 *   out: window.__renderPoints  -> points accumulated so far
 *        window.__renderLimit() -> points needed for the target quality
 *        window.__renderError   -> string, set on failure
 *        the single <canvas> holds the image once points >= limit
 *
 * Convergence is points-vs-limit rather than Flam3's `setCurrentQuality`
 * accessor: that accessor reads the GLOBAL accumulated-point signal, which only
 * the main workspace export renderer ever writes (Flam3.tsx, guarded by
 * `isExportRenderer`). Read from any other renderer it is a constant 0, i.e. a
 * quality of -Infinity forever. Points-vs-limit is the same condition the
 * render loop itself stops on, so the driver and the renderer agree by
 * construction.
 */
type RenderJob = {
  flame: FlameDescriptor
  width: number
  height: number
  quality: number
}

type HeadlessWindow = Window & {
  __renderJob?: RenderJob
  __renderError?: string
  __renderReady?: boolean
  __renderPoints?: number
  __renderLimit?: () => number
}

export function HeadlessRender() {
  const [job, setJob] = createSignal<RenderJob>()

  onMount(() => {
    const w = window as HeadlessWindow
    // The driver may inject the job before or after mount; poll briefly.
    const pick = () => {
      if (w.__renderJob) {
        setJob(w.__renderJob)
        return true
      }
      return false
    }
    if (!pick()) {
      const started = Date.now()
      const timer = setInterval(() => {
        if (pick() || Date.now() - started > 30_000) clearInterval(timer)
      }, 50)
    }
    w.__renderReady = true
  })

  return (
    <Show when={job()}>
      {(j) => (
        <div
          style={{
            width: `${j().width}px`,
            height: `${j().height}px`,
            background: '#000',
          }}
        >
          <Root adapterOptions={{ powerPreference: 'high-performance' }}>
            <AutoCanvas
              class="headless-canvas"
              pixelRatio={1}
              fixedResolution={{ width: j().width, height: j().height }}
            >
              <Camera2D
                position={vec2f(
                  j().flame.renderSettings.camera.position[0] ?? 0,
                  j().flame.renderSettings.camera.position[1] ?? 0,
                )}
                zoom={j().flame.renderSettings.camera.zoom}
              >
                <Flam3
                  animationEnabled={false}
                  quality={j().quality}
                  pointCountPerBatch={4096}
                  adaptiveFilterEnabled
                  flameDescriptor={j().flame}
                  renderInterval={1}
                  edgeFadeColor={vec4f(0)}
                  setQualityPointCountLimit={(get) => {
                    ;(window as HeadlessWindow).__renderLimit = get
                  }}
                  onAccumulatedPointCount={(count) => {
                    ;(window as HeadlessWindow).__renderPoints = count
                  }}
                />
              </Camera2D>
            </AutoCanvas>
          </Root>
        </div>
      )}
    </Show>
  )
}
