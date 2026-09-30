// A desktop specimen bench for comparing reproducible fractal cores and framing.
import './bench.css'
import { createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { BENCH_RECIPES } from './recipes'
import { BenchRuntime, DEFAULT_BENCH_SETTINGS } from './runtime'
import type { BenchSettings } from './runtime'

export function Bench() {
  let canvas!: HTMLCanvasElement
  let runtime: BenchRuntime | undefined
  const [state, setState] = createSignal<ReturnType<BenchRuntime['snapshot']>>()
  const [initError, setInitError] = createSignal('')
  const settings = () => state()?.settings ?? DEFAULT_BENCH_SETTINGS
  const ready = () => state()?.ready ?? false
  const error = () => initError() || state()?.error || ''
  const frameInterval = () => {
    const interval = state()?.frameIntervalMs
    return interval === undefined || interval === null
      ? 'Measuring'
      : `${interval.toFixed(1)} ms`
  }
  const recipe = createMemo(
    () =>
      BENCH_RECIPES.find((entry) => entry.index === settings().recipe) ??
      BENCH_RECIPES[0],
  )
  const update = () => {
    if (runtime) setState(runtime.snapshot())
  }
  const change = (patch: Partial<BenchSettings>) => runtime?.setSettings(patch)

  onMount(() => {
    runtime = new BenchRuntime(canvas, update)
    if (import.meta.env.DEV) window.__orbBench = runtime
    void runtime.init().catch((cause: unknown) => {
      setInitError(cause instanceof Error ? cause.message : String(cause))
    })
  })
  onCleanup(() => {
    runtime?.dispose()
    if (import.meta.env.DEV) delete window.__orbBench
  })

  function downloadStudy() {
    if (!runtime || !ready()) return
    const url = URL.createObjectURL(
      new Blob([runtime.exportStudy()], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `irchiinnuss-${recipe().id}-study.json`
    link.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)
  }

  return (
    <main class="orb-bench">
      <header class="bench-header">
        <a
          class="bench-brand"
          href="/"
          aria-label="Lumen Apeiron, return to XR lab"
        >
          <span class="bench-brand-mark" aria-hidden="true" />
          <span>
            Lumen <span class="bench-brand-secondary">Apeiron</span>
          </span>
        </a>
        <span class="bench-header-caption">Irchiinnuss observatory</span>
        <a class="bench-lab-link" href="/">
          Open XR lab
        </a>
      </header>

      <div class="bench-workspace">
        <section class="bench-specimens" aria-labelledby="bench-title">
          <h1 id="bench-title">
            A world,
            <br /> in a flame.
          </h1>
          <p class="bench-intro">
            Turn it. Get closer. Find the form worth building a world around.
          </p>
          <h2 class="bench-section-title">Choose a specimen</h2>
          <div class="bench-recipe-list">
            <For each={BENCH_RECIPES}>
              {(entry) => (
                <button
                  type="button"
                  class="bench-recipe"
                  aria-pressed={settings().recipe === entry.index}
                  disabled={!ready()}
                  onClick={() => change({ recipe: entry.index })}
                >
                  <span
                    class={`bench-recipe-symbol bench-recipe-symbol-${entry.index}`}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                  <span class="bench-recipe-copy">
                    <strong>{entry.name}</strong>
                    <span>{entry.formula}</span>
                  </span>
                </button>
              )}
            </For>
          </div>
          <p class="bench-specimen-note">
            One mathematical core. The rings are separate geometry.
          </p>
          <div class="bench-left-footer">
            <span>Desktop form study</span>
            <p>Keep the same seed to compare shape, light and detail.</p>
          </div>
        </section>

        <section class="bench-stage" aria-label="Fractal specimen viewer">
          <canvas
            ref={canvas}
            class="bench-canvas"
            tabIndex={0}
            aria-label="Interactive three-dimensional fractal specimen"
            aria-describedby="bench-canvas-help"
          />
          <div class="bench-stage-top" aria-hidden="true">
            <span>
              {(state()?.activeSource ?? settings().source) === 'compute'
                ? 'GPU generated'
                : 'CPU cached'}
            </span>
            <span>{settings().rotation ? 'Rotating' : 'Still study'}</span>
          </div>
          <Show when={!ready() && !error()}>
            <div class="bench-loading" role="status">
              Preparing the specimen…
            </div>
          </Show>
          <Show when={error()}>
            <div class="bench-error" role="alert">
              <h2>The specimen could not open</h2>
              <p>{error()}</p>
              <p>
                Open this HTTPS page in a browser with WebGPU enabled, then
                reload it.
              </p>
              <button
                type="button"
                onClick={() => {
                  window.location.reload()
                }}
              >
                Reload bench
              </button>
            </div>
          </Show>
          <div class="bench-stage-caption">
            <h2>{recipe().name}</h2>
            <p>{recipe().description}</p>
            <p id="bench-canvas-help" class="bench-canvas-help">
              Drag to orbit. Scroll to zoom. Focus the view and use arrow keys
              to orbit.
            </p>
          </div>
          <fieldset class="bench-camera" disabled={!ready()}>
            <legend class="bench-sr-only">Inspection angle</legend>
            <div class="bench-camera-poses">
              <button
                type="button"
                onClick={() => change({ yaw: 0, pitch: 0, rotation: false })}
              >
                Front
              </button>
              <button
                type="button"
                onClick={() => change({ yaw: 90, pitch: 0, rotation: false })}
              >
                Side
              </button>
              <button
                type="button"
                onClick={() => change({ yaw: 0, pitch: 70, rotation: false })}
              >
                Above
              </button>
              <button
                type="button"
                onClick={() => change({ yaw: 180, pitch: 0, rotation: false })}
              >
                Back
              </button>
              <button type="button" onClick={() => runtime?.resetView()}>
                Reset view
              </button>
            </div>
            <button
              type="button"
              class="bench-rotation"
              aria-pressed={settings().rotation}
              onClick={() => change({ rotation: !settings().rotation })}
            >
              {settings().rotation ? 'Stop rotation' : 'Rotate specimen'}
            </button>
          </fieldset>
        </section>

        <aside class="bench-inspector" aria-labelledby="bench-controls-title">
          <h2 id="bench-controls-title" class="bench-section-title">
            Study controls
          </h2>
          <fieldset class="bench-fields" disabled={!ready()}>
            <legend class="bench-sr-only">Rendering and presentation</legend>
            <label class="bench-field">
              <span>Point source</span>
              <select
                value={settings().source}
                onChange={(event) =>
                  change({
                    source: event.currentTarget
                      .value as BenchSettings['source'],
                  })
                }
              >
                <option value="compute">GPU generated</option>
                <option value="cached">CPU cached</option>
              </select>
            </label>
            <label class="bench-field">
              <span>Point count</span>
              <select
                value={settings().pointCount}
                onChange={(event) =>
                  change({ pointCount: Number(event.currentTarget.value) })
                }
              >
                <option value="32768">32,768</option>
                <option value="131072">131,072</option>
                <option value="524288">524,288 (experimental)</option>
              </select>
            </label>
            <p class="bench-field-hint" role="status">
              {state()?.sampling
                ? 'Building CPU reference. Showing GPU specimen.'
                : 'Same recipe and seed in both sources.'}
            </p>

            <div
              class="bench-palette-group"
              role="group"
              aria-label="Color palette"
            >
              <span class="bench-field-label">Color palette</span>
              <div class="bench-palettes">
                <For each={['lagoon', 'ember', 'violet', 'ivory'] as const}>
                  {(palette) => (
                    <button
                      type="button"
                      class={`bench-palette bench-palette-${palette}`}
                      aria-pressed={settings().palette === palette}
                      onClick={() => change({ palette })}
                    >
                      <span aria-hidden="true" />
                      {palette[0].toUpperCase() + palette.slice(1)}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <label class="bench-field bench-range">
              <span>
                Brightness <output>{settings().exposure.toFixed(2)}</output>
              </span>
              <input
                type="range"
                min="0.3"
                max="2"
                step="0.05"
                value={settings().exposure}
                onInput={(event) =>
                  change({ exposure: event.currentTarget.valueAsNumber })
                }
              />
            </label>
            <label class="bench-field bench-range">
              <span>
                View distance <output>{settings().distance.toFixed(2)}</output>
              </span>
              <input
                type="range"
                min="1.4"
                max="6"
                step="0.05"
                value={settings().distance}
                onInput={(event) =>
                  change({ distance: event.currentTarget.valueAsNumber })
                }
              />
            </label>

            <div class="bench-framing" role="group" aria-label="Surroundings">
              <label class="bench-check">
                <input
                  type="checkbox"
                  checked={settings().rings}
                  onChange={(event) =>
                    change({ rings: event.currentTarget.checked })
                  }
                />
                <span>Orbital rings</span>
              </label>
              <label class="bench-check">
                <input
                  type="checkbox"
                  checked={settings().stars}
                  onChange={(event) =>
                    change({ stars: event.currentTarget.checked })
                  }
                />
                <span>Star field</span>
              </label>
            </div>

            <details class="bench-advanced">
              <summary>Sampling and depth</summary>
              <label class="bench-field bench-range">
                <span>
                  Point radius{' '}
                  <output>{settings().pointSize.toFixed(4)}</output>
                </span>
                <input
                  type="range"
                  min="0.001"
                  max="0.008"
                  step="0.0005"
                  value={settings().pointSize}
                  onInput={(event) =>
                    change({ pointSize: event.currentTarget.valueAsNumber })
                  }
                />
              </label>
              <label class="bench-field">
                <span>Seed</span>
                <input
                  type="number"
                  min="1"
                  max="2147483647"
                  step="1"
                  value={settings().seed}
                  onChange={(event) => {
                    if (
                      event.currentTarget.validity.valid &&
                      Number.isFinite(event.currentTarget.valueAsNumber)
                    )
                      change({ seed: event.currentTarget.valueAsNumber })
                  }}
                />
              </label>
              <label class="bench-field">
                <span>Opaque depth probe</span>
                <select
                  value={settings().depthProbe}
                  onChange={(event) =>
                    change({
                      depthProbe: event.currentTarget
                        .value as BenchSettings['depthProbe'],
                    })
                  }
                >
                  <option value="off">Hidden</option>
                  <option value="front">In front of the core</option>
                  <option value="through">Through the core</option>
                  <option value="behind">Behind the core</option>
                </select>
              </label>
              <p class="bench-field-hint">
                A solid bar tests how the flame overlaps solid objects. View it
                from the front first.
              </p>
              <button
                class="bench-rebuild"
                type="button"
                onClick={() => runtime?.rebuild()}
              >
                Rebuild same specimen
              </button>
            </details>
            <button class="bench-save" type="button" onClick={downloadStudy}>
              Save study settings
            </button>
          </fieldset>
          <p class="bench-export-note">Downloads a recipe and view as JSON.</p>
        </aside>
      </div>

      <footer class="bench-footer">
        <span class="bench-footer-place">
          Irchiinnuss <span>Form archive</span>
        </span>
        <dl class="bench-readings">
          <div>
            <dt>Points</dt>
            <dd>
              {(state()?.pointCount ?? settings().pointCount).toLocaleString(
                'en-US',
              )}
            </dd>
          </div>
          <div>
            <dt>Generation</dt>
            <dd>{state()?.generation ?? 0}</dd>
          </div>
          <div>
            <dt>Frame interval</dt>
            <dd>{frameInterval()}</dd>
          </div>
        </dl>
        <span class="bench-footer-status">
          Desktop counts. Headset budget unmeasured.
        </span>
      </footer>
      <Show when={(state()?.errors.length ?? 0) > 0 && !error()}>
        <div class="bench-runtime-errors" role="alert">
          <For each={state()?.errors}>{(message) => <p>{message}</p>}</For>
        </div>
      </Show>
    </main>
  )
}
