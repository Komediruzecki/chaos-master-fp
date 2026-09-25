// Solid controls for an isolated, native-only WebGPU XR capability lab.
import './style.css'
import { createSignal, onCleanup, onMount } from 'solid-js'
import { render } from 'solid-js/web'
import { Diagnostics } from './Diagnostics'
import { LabRuntime } from './runtime'
import type { SceneMode } from './renderer'

function Lab() {
  let canvas!: HTMLCanvasElement
  let runtime: LabRuntime | undefined
  const [state, setState] = createSignal<ReturnType<LabRuntime['snapshot']>>()
  const [entering, setEntering] = createSignal(false)
  const [mode, setMode] = createSignal<SceneMode>('cached')
  const [distance, setDistance] = createSignal(2.9)
  const [yaw, setYaw] = createSignal(0)
  const ready = () => state()?.ready ?? false
  const cameraDisabled = () => !ready() || !!state()?.immersive
  const entryDisabled = () =>
    !ready() || !state()?.caps?.xrCandidate || entering()
  const update = () => {
    if (runtime) {
      setState(runtime.snapshot())
      setEntering(runtime.entering)
    }
  }
  onMount(() => {
    runtime = new LabRuntime(canvas, update)
    if (import.meta.env.DEV) window.__lumenGpuXr = runtime
    void runtime.init()
  })
  onCleanup(() => {
    runtime?.dispose()
    delete window.__lumenGpuXr
  })

  function exportReport() {
    if (!runtime) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(runtime.snapshot(), null, 2)], {
        type: 'application/json',
      }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'lumen-webgpu-xr-report.json'
    link.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)
  }
  return (
    <main>
      <canvas
        ref={canvas}
        aria-label="World-space fractal rendered with WebGPU"
      />
      <header>
        <a class="brand" href="/">
          LUMEN <span>APEIRON</span>
        </a>
        <span class="tag">RENDER LAB / 03</span>
      </header>
      <section class="intro" aria-labelledby="title">
        <p class="eyebrow">IRCHIINNUSS · NATIVE WEBGPU</p>
        <h1 id="title">
          One flame.
          <br />
          Two perspectives.
        </h1>
        <p class="description">
          A shared world of light, computed on the GPU.
          <br />
          The first step toward a native Quest journey.
        </p>
      </section>
      <section class="controls" aria-label="Experiment controls">
        <p class="eyebrow">EXPERIMENT</p>
        <label>
          Scene
          <select
            aria-label="Scene"
            value={mode()}
            onChange={(event) => {
              const value = event.currentTarget.value as SceneMode
              setMode(value)
              if (runtime) runtime.mode = value
              update()
            }}
            disabled={!ready()}
          >
            <option value="probe">01 / Geometry probe</option>
            <option value="cached">02 / Cached flame</option>
            <option value="compute">03 / Live GPU flame</option>
          </select>
        </label>
        <div class="button-row">
          <button
            disabled={!ready()}
            onClick={() => {
              if (runtime) runtime.paused = !runtime.paused
              update()
            }}
          >
            {state()?.paused ? 'Resume motion' : 'Hold motion'}
          </button>
          <button
            disabled={cameraDisabled()}
            aria-pressed={state()?.stereoPreview ?? false}
            onClick={() => {
              if (runtime) runtime.stereo = !runtime.stereo
              update()
            }}
          >
            Two-eye preview
          </button>
        </div>
        <label>
          Distance <span>{distance().toFixed(1)} m</span>
          <input
            aria-label="Distance"
            type="range"
            min="0.8"
            max="5"
            step="0.1"
            value={distance()}
            disabled={cameraDisabled()}
            onInput={(event) => {
              setDistance(event.currentTarget.valueAsNumber)
              if (runtime) runtime.distance = distance()
            }}
          />
        </label>
        <label>
          Orbit <span>{yaw()}°</span>
          <input
            aria-label="Orbit"
            type="range"
            min="-90"
            max="90"
            step="1"
            value={yaw()}
            disabled={cameraDisabled()}
            onInput={(event) => {
              setYaw(event.currentTarget.valueAsNumber)
              if (runtime) runtime.yaw = yaw()
            }}
          />
        </label>
        <button
          class="enter"
          disabled={entryDisabled()}
          onClick={() => {
            if (state()?.immersive) void runtime?.exit()
            else void runtime?.enter()
          }}
        >
          {state()?.immersive
            ? 'Leave WebGPU VR'
            : entering()
              ? 'Opening native session…'
              : 'Enter WebGPU VR'}
        </button>
        <p class="hint">
          Desktop sliders move the camera. In VR, move your head; trigger or
          pinch holds motion. No locomotion or audio in this proof.
        </p>
      </section>
      <Diagnostics state={state()} exportReport={exportReport} />
      <footer>
        <span>
          IRCHIINNUSS <i>/</i> VERDANT STUDY
        </span>
        <span>EXPERIMENTAL · HEADSET VALIDATION PENDING</span>
      </footer>
    </main>
  )
}

render(() => <Lab />, document.getElementById('root')!)
