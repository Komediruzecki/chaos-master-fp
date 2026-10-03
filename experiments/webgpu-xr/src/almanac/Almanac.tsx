// A Blender-authored Almanac shares one persistent GPU scene with its live orbs.
import './almanac.css'
import { createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { BENCH_RECIPES } from '../bench/recipes'
import { BenchRuntime, DEFAULT_BENCH_SETTINGS } from '../bench/runtime'
import { ALMANAC_WORLDS, settingsForWorld } from './catalog'
import { MotifAudio } from './motifAudio'
import type { BenchSettings } from '../bench/runtime'
import type { AlmanacWorld } from './catalog'

const pitchName = (midi: number) =>
  `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`

export function Almanac() {
  let canvas!: HTMLCanvasElement
  let inspectButton!: HTMLButtonElement
  let returnButton!: HTMLButtonElement
  let runtime: BenchRuntime | undefined
  let audio: MotifAudio | undefined
  const savedViews = new Map<string, BenchSettings>()
  const [selectedId, setSelectedId] = createSignal(ALMANAC_WORLDS[0].id)
  const [inspecting, setInspecting] = createSignal(false)
  const [clay, setClay] = createSignal(false)
  const [state, setState] = createSignal<ReturnType<BenchRuntime['snapshot']>>()
  const [sound, setSound] = createSignal<ReturnType<MotifAudio['snapshot']>>()
  const world = createMemo(
    () =>
      ALMANAC_WORLDS.find((item) => item.id === selectedId()) ??
      ALMANAC_WORLDS[0],
  )
  const hasSpecimen = createMemo(() => Boolean(world().specimen))
  const ready = createMemo(
    () => Boolean(state()?.ready) && state()?.book.status === 'ready',
  )
  const settings = () => state()?.settings ?? DEFAULT_BENCH_SETTINGS
  const specimenName = createMemo(
    () =>
      BENCH_RECIPES.find((item) => item.id === world().specimen?.recipeId)
        ?.name ?? '',
  )
  const pitchRange = createMemo(() => {
    const pitches = world().motif?.notes.map((note) => note.midi) ?? [60]
    return {
      low: Math.min(...pitches),
      span: Math.max(1, Math.max(...pitches) - Math.min(...pitches)),
    }
  })
  const studies = ALMANAC_WORLDS.filter((item) => item.status === 'study')
  const previews = ALMANAC_WORLDS.filter((item) => item.status === 'preview')
  const update = () => {
    if (runtime) setState(runtime.snapshot())
  }
  const updateSound = () => {
    if (audio) setSound(audio.snapshot())
  }

  function selectWorld(entry: AlmanacWorld) {
    if (entry.id === selectedId()) return
    if (hasSpecimen() && runtime)
      savedViews.set(selectedId(), runtime.snapshot().settings)
    audio?.stop()
    setSelectedId(entry.id)
    const next = savedViews.get(entry.id) ?? settingsForWorld(entry)
    runtime?.setActive(Boolean(next))
    if (next) {
      runtime?.setBookDock(entry.id === 'tideweave' ? 'right' : 'left')
      runtime?.setSettings({ ...DEFAULT_BENCH_SETTINGS, ...next, stars: true })
    } else runtime?.setSettings({ rotation: false })
  }

  function inspect() {
    if (!ready() || !hasSpecimen()) return
    runtime?.setBookInspection(true)
    setInspecting(true)
    queueMicrotask(() => {
      returnButton.focus({ preventScroll: true })
    })
  }

  function returnToBook() {
    runtime?.setBookInspection(false)
    setInspecting(false)
    queueMicrotask(() => {
      inspectButton.focus({ preventScroll: true })
    })
  }

  function playMotif() {
    if (sound()?.loading || sound()?.playing) audio?.stop()
    else if (world().motif) void audio?.play(world().motif!)
  }

  onMount(() => {
    runtime = new BenchRuntime(canvas, update)
    audio = new MotifAudio(updateSound)
    updateSound()
    runtime.setScene('book')
    runtime.setBookDock('left')
    runtime.setSettings({ ...settingsForWorld(world()), stars: true })
    void runtime.init()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && inspecting()) {
        event.preventDefault()
        returnToBook()
      }
    }
    window.addEventListener('keydown', onKey)
    if (import.meta.env.DEV) {
      window.__almanac = {
        runtime,
        audio,
        get selectedId() {
          return selectedId()
        },
        get inspecting() {
          return inspecting()
        },
      }
    }
    onCleanup(() => {
      window.removeEventListener('keydown', onKey)
      audio?.dispose()
      runtime?.dispose()
      if (import.meta.env.DEV) delete window.__almanac
    })
  })

  return (
    <main
      class="almanac"
      classList={{ 'is-inspecting': inspecting() }}
      data-world={selectedId()}
    >
      <header class="almanac-header">
        <a
          class="almanac-brand"
          href="/"
          aria-label="Lumen Apeiron, return to XR lab"
        >
          <span class="almanac-brand-mark" aria-hidden="true" />
          <span>
            Lumen <span>Apeiron</span>
          </span>
        </a>
        <span class="almanac-header-place">Book of seven constellations</span>
        <a class="almanac-bench-link" href="/bench">
          Orb bench
        </a>
      </header>

      <section class="almanac-observatory" aria-labelledby="almanac-title">
        <div class="almanac-scene-toolbar">
          <div class="almanac-title-group">
            <h1 id="almanac-title">Almanac</h1>
            <span>Irchiinnuss</span>
          </div>
          <nav
            class="almanac-worlds"
            aria-label="World studies"
            hidden={inspecting()}
          >
            <For each={studies}>
              {(entry) => (
                <button
                  type="button"
                  class="almanac-world"
                  aria-pressed={selectedId() === entry.id}
                  onClick={() => {
                    selectWorld(entry)
                  }}
                >
                  <span
                    class={`almanac-seal almanac-seal-${entry.id}`}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                  <span class="almanac-world-copy">
                    <strong>{entry.name}</strong>
                    <span>
                      {entry.tonic} {entry.mode}
                    </span>
                  </span>
                </button>
              )}
            </For>
          </nav>
          <div class="almanac-presentation-tools">
            <Show when={hasSpecimen()}>
              <button
                type="button"
                class="almanac-control almanac-material-control"
                aria-pressed={clay()}
                disabled={!ready()}
                onClick={() => {
                  const next = !clay()
                  setClay(next)
                  runtime?.setBookClay(next)
                }}
              >
                Clay view
              </button>
            </Show>
            <Show when={inspecting()}>
              <button
                ref={returnButton}
                class="almanac-return almanac-control"
                type="button"
                onClick={returnToBook}
              >
                Return to Almanac <span>Esc</span>
              </button>
            </Show>
          </div>
        </div>

        <div
          class="almanac-orb-stage"
          classList={{ 'is-preview': !hasSpecimen() }}
        >
          <canvas
            ref={canvas}
            class="almanac-canvas"
            hidden={!hasSpecimen()}
            tabIndex={hasSpecimen() ? 0 : -1}
            aria-label={`Interactive ${world().name} fractal orb`}
            aria-describedby="almanac-view-help"
          />
          <Show
            when={
              hasSpecimen() &&
              !ready() &&
              !state()?.error &&
              state()?.book.status !== 'error'
            }
          >
            <p class="almanac-stage-message" role="status">
              Opening the Almanac…
            </p>
          </Show>
          <Show when={hasSpecimen() && state()?.error}>
            <div class="almanac-stage-message almanac-gpu-error" role="alert">
              <h3>The Almanac could not open</h3>
              <p>{state()?.error}</p>
              <button
                class="almanac-control"
                type="button"
                onClick={() => {
                  window.location.reload()
                }}
              >
                Reload Almanac
              </button>
            </div>
          </Show>
          <Show when={hasSpecimen() && state()?.book.status === 'error'}>
            <div class="almanac-stage-message almanac-gpu-error" role="alert">
              <h3>The book could not load</h3>
              <p>{state()?.book.error}</p>
              <button
                class="almanac-control"
                type="button"
                onClick={() => runtime?.retryBook()}
              >
                Retry book
              </button>
            </div>
          </Show>
          <Show when={!hasSpecimen()}>
            <div class="almanac-unwritten">
              <span class="almanac-unwritten-orbit" aria-hidden="true" />
              <h3>An unwritten world</h3>
              <p>
                This constellation has a direction, but no orb or motif yet.
              </p>
            </div>
          </Show>
          <Show when={hasSpecimen()}>
            <div class="almanac-orb-caption">
              <span>{specimenName()}</span>
              <span>
                {world().id === 'glasswake'
                  ? 'Glasswake specimen'
                  : 'Tideweave form study'}
              </span>
            </div>
          </Show>
          <Show when={hasSpecimen()}>
            <div
              class="almanac-camera-tools"
              role="group"
              aria-label="Almanac camera"
            >
              <button
                class="almanac-control"
                type="button"
                disabled={!ready()}
                onClick={() =>
                  runtime?.setSettings({
                    distance: settings().distance - 0.3,
                  })
                }
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                class="almanac-control"
                type="button"
                disabled={!ready()}
                onClick={() =>
                  runtime?.setSettings({
                    distance: settings().distance + 0.3,
                  })
                }
                aria-label="Zoom out"
              >
                −
              </button>
              <button
                class="almanac-control"
                type="button"
                disabled={!ready()}
                onClick={() => runtime?.resetView()}
              >
                Reset view
              </button>
            </div>
          </Show>
        </div>
        <div class="almanac-scene-caption">
          <p id="almanac-view-help" class="almanac-view-help">
            {hasSpecimen()
              ? 'Drag to turn. Scroll to zoom. Arrow keys turn the focused view.'
              : 'Choose Glasswake or Tideweave to return to the book.'}
          </p>
          <span class="almanac-folio">
            {ALMANAC_WORLDS.findIndex((entry) => entry.id === selectedId()) + 1}{' '}
            / 7
          </span>
        </div>
      </section>

      <section
        class="almanac-listening-desk"
        aria-labelledby="almanac-world-title"
      >
        <div class="almanac-entry-copy">
          <div class="almanac-page-heading">
            <h2 id="almanac-world-title">{world().name}</h2>
            <span class="almanac-world-mode">
              {world().tonic} {world().mode}
              {world().status === 'preview' ? ' (proposed)' : ''}
            </span>
          </div>
          <p>{world().summary}</p>
          <Show when={world().id === 'tideweave'}>
            <p class="almanac-provisional">
              Thicket is a placeholder form while Tideweave takes shape.
            </p>
          </Show>
          <Show when={hasSpecimen()}>
            <button
              ref={inspectButton}
              class="almanac-inspect almanac-control"
              type="button"
              disabled={!ready()}
              hidden={inspecting()}
              onClick={inspect}
            >
              Inspect orb
            </button>
          </Show>
        </div>

        <div
          class="almanac-motif"
          classList={{ 'is-playing': sound()?.playing ?? false }}
        >
          <Show
            when={world().motif}
            fallback={
              <p class="almanac-motif-pending">
                The musical signature is still to be written.
              </p>
            }
          >
            {(motif) => (
              <>
                <div class="almanac-motif-heading">
                  <span>World motif</span>
                  <span>{motif().tempo} beats / min</span>
                </div>
                <div
                  class="almanac-phrase"
                  role="img"
                  aria-label={`Motif notes: ${motif()
                    .notes.map((note) => pitchName(note.midi))
                    .join(', ')}`}
                >
                  <For each={motif().notes}>
                    {(note, index) => (
                      <span
                        class="almanac-note"
                        classList={{
                          'is-active':
                            sound()?.activeNote === index() &&
                            Boolean(sound()?.playing),
                        }}
                        style={{
                          '--pitch': `${(note.midi - pitchRange().low) / pitchRange().span}`,
                          '--length': `${note.duration}`,
                        }}
                      >
                        <i />
                        <span>{pitchName(note.midi)}</span>
                      </span>
                    )}
                  </For>
                </div>
                <div class="almanac-audio-controls">
                  <button
                    class="almanac-control almanac-play"
                    type="button"
                    onClick={playMotif}
                  >
                    {sound()?.loading
                      ? 'Cancel motif'
                      : sound()?.playing
                        ? 'Stop motif'
                        : 'Play motif'}
                  </button>
                  <label class="almanac-volume-control">
                    <span>Volume</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={sound()?.volume ?? 0.5}
                      onInput={(event) =>
                        audio?.setVolume(event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                  <span class="almanac-playback-status" role="status">
                    {sound()?.loading
                      ? 'Opening audio…'
                      : sound()?.playing
                        ? 'Playing'
                        : 'Press play to listen'}
                  </span>
                </div>
                <div class="almanac-motif-progress" aria-hidden="true">
                  <span
                    style={{ width: `${(sound()?.progress ?? 0) * 100}%` }}
                  />
                </div>
              </>
            )}
          </Show>
          <Show when={sound()?.error}>
            <p class="almanac-audio-error" role="alert">
              {sound()?.error}
            </p>
          </Show>
        </div>
      </section>
      <section
        class="almanac-horizons"
        aria-labelledby="almanac-horizons-title"
        hidden={inspecting()}
      >
        <div>
          <h2 id="almanac-horizons-title">Beyond these pages</h2>
          <p>Five world proposals. Their games are still to come.</p>
        </div>
        <nav
          class="almanac-previews"
          aria-label="Future constellation previews"
        >
          <For each={previews}>
            {(entry) => (
              <button
                type="button"
                class="almanac-preview"
                aria-pressed={selectedId() === entry.id}
                onClick={() => {
                  selectWorld(entry)
                }}
              >
                <span class="almanac-preview-mark" aria-hidden="true" />
                <span>{entry.name}</span>
              </button>
            )}
          </For>
        </nav>
      </section>
      <footer class="almanac-footer">
        <span>Irchiinnuss</span>
        <p>Live fractals. Original motifs. A book taking shape.</p>
        <a href="/bench">Compare orb recipes</a>
      </footer>
    </main>
  )
}

declare global {
  interface Window {
    __almanac?: {
      runtime: BenchRuntime
      audio: MotifAudio
      readonly selectedId: string
      readonly inspecting: boolean
    }
  }
}
