// Solid diagnostics shell for the isolated GL experiment; no headset claims.
import './style.css'
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { createCloud } from './cloud'
import { runProbes } from './probes'

declare global {
  interface Window {
    __glSpike?: ReturnType<typeof runProbes> & {
      cloud?: { pointCount: number; frames: number }
      error?: string
    }
  }
}

function App() {
  let canvas!: HTMLCanvasElement
  const [result, setResult] = createSignal<ReturnType<typeof runProbes>>()
  const [error, setError] = createSignal('')
  const [paused, setPaused] = createSignal(false)
  const [zoom, setZoom] = createSignal(1)
  let stop: (() => void) | undefined
  onMount(() => {
    try {
      const report = runProbes()
      window.__glSpike = report
      setResult(report)
      const cloud = createCloud(canvas)
      const cloudReport = { pointCount: cloud.pointCount, frames: 0 }
      window.__glSpike.cloud = cloudReport
      let frame = 0
      let angle = 0.6
      let last = window.performance.now()
      const resize = () => {
        canvas.width = Math.max(
          1,
          Math.round(
            canvas.clientWidth * Math.min(window.devicePixelRatio, 1.5),
          ),
        )
        canvas.height = Math.max(
          1,
          Math.round(
            canvas.clientHeight * Math.min(window.devicePixelRatio, 1.5),
          ),
        )
      }
      const observer = new ResizeObserver(resize)
      observer.observe(canvas)
      resize()
      const loop = (now: number) => {
        if (!paused()) angle += Math.min(now - last, 50) * 0.00014
        last = now
        cloud.draw(angle, zoom())
        cloudReport.frames++
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)
      stop = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        cloud.dispose()
      }
    } catch (cause) {
      const message = String(cause)
      setError(message)
      if (window.__glSpike) window.__glSpike.error = message
    }
  })
  onCleanup(() => stop?.())
  return (
    <main>
      <header>
        <p class="eyebrow">Lumen Apeiron / rendering research</p>
        <h1>One flame. A second backend.</h1>
        <p>
          Actual app variation math, compiled to GLSL. A small CPU-sampled 3D
          cloud rendered through TypeGPU's WebGL 2 fallback.
        </p>
      </header>
      <section class="stage">
        <canvas
          ref={canvas}
          aria-label="Rotating three-dimensional flame point cloud"
        />
        <div class="controls">
          <button onClick={() => setPaused(!paused())}>
            {paused() ? 'Resume orbit' : 'Pause orbit'}
          </button>
          <label>
            Scale{' '}
            <input
              type="range"
              min=".5"
              max="1.8"
              step=".05"
              value={zoom()}
              onInput={(event) => setZoom(Number(event.currentTarget.value))}
            />
          </label>
        </div>
      </section>
      <p class="limit">
        Desktop compatibility experiment. 16,384 points; CPU generation; no live
        compute, density accumulation, stereo or XR session.
      </p>
      <Show when={error()}>
        <pre role="alert">{error()}</pre>
      </Show>
      <Show when={result()}>
        {(report) => (
          <>
            <p class="hardware">{report().renderer}</p>
            <h2>Measured checks</h2>
            <ul>
              <For each={report().probes}>
                {(probe) => (
                  <li classList={{ failed: !probe.passed }}>
                    <strong>
                      {probe.passed ? 'PASS' : 'FAIL'} · {probe.name}
                    </strong>
                    <span>{probe.detail}</span>
                  </li>
                )}
              </For>
            </ul>
          </>
        )}
      </Show>
    </main>
  )
}
render(() => <App />, document.getElementById('root')!)
