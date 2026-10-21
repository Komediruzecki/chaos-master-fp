// A Blender-authored Almanac shares one persistent GPU scene with its live orbs.
import '../theme/lumen.css'
import './almanac.css'
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack, } from 'solid-js'
import { BENCH_RECIPES } from '../bench/recipes'
import { BenchRuntime, DEFAULT_BENCH_SETTINGS } from '../bench/runtime'
import { journeyPageStatus, JourneySaveStatus } from '../journey/JourneyPanels'
import { isJourneyWorldId } from '../journey/progress'
import { useJourney } from '../journey/useJourney'
import { Icon, LogoMark } from '../theme/Icon'
import { PageGlyph } from '../theme/PageGlyph'
import { earnedBookAwards } from './bookAwards'
import { ALMANAC_WORLDS, settingsForWorld } from './catalog'
import { MotifAudio } from './motifAudio'
import { staffNote } from './staff'
import type { BenchSettings } from '../bench/runtime'
import type { AlmanacWorld } from './catalog'

export function Almanac() {
  let canvas!: HTMLCanvasElement
  let inspectButton!: HTMLButtonElement
  let returnButton!: HTMLButtonElement
  let runtime: BenchRuntime | undefined
  let audio: MotifAudio | undefined
  const journey = useJourney()
  const savedViews = new Map<string, BenchSettings>()
  const [selectedId, setSelectedId] = createSignal<string>(
    journey.snapshot().progress.lastSelectedWorld,
  )
  const [inspecting, setInspecting] = createSignal(false)
  const [clay, setClay] = createSignal(false)
  const [state, setState] = createSignal<ReturnType<BenchRuntime['snapshot']>>()
  const [sound, setSound] = createSignal<ReturnType<MotifAudio['snapshot']>>()
  const completion = createMemo(() => {
    const id = selectedId()
    return isJourneyWorldId(id)
      ? journey.snapshot().progress.worlds[id].completion
      : null
  })
  const pageStatus = createMemo(() => {
    const id = selectedId()
    return isJourneyWorldId(id)
      ? journeyPageStatus(journey.snapshot().progress, id)
      : 'preview'
  })
  const world = createMemo<AlmanacWorld>(() => {
    const entry =
      ALMANAC_WORLDS.find((item) => item.id === selectedId()) ??
      ALMANAC_WORLDS[0]
    const page = completion()
    return page
      ? {
          ...entry,
          name: page.name,
          tonic: page.tonic,
          mode: page.mode,
          specimen: page.specimen,
          motif: page.motif,
        }
      : entry
  })
  const returnWorld = createMemo(() =>
    isJourneyWorldId(selectedId())
      ? selectedId()
      : journey.snapshot().progress.lastSelectedWorld,
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
  const earnedCount = createMemo(
    () =>
      Object.values(journey.snapshot().progress.worlds).filter(
        (entry) => entry.completion,
      ).length,
  )
  const earned = (id: string) =>
    isJourneyWorldId(id) &&
    Boolean(journey.snapshot().progress.worlds[id].completion)
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
  const pageIndex = createMemo(() =>
    ALMANAC_WORLDS.findIndex((entry) => entry.id === selectedId()),
  )
  const studies = ALMANAC_WORLDS.filter((item) => item.status === 'study')
  const update = () => {
    if (runtime) setState(runtime.snapshot())
  }
  const updateSound = () => {
    if (audio) setSound(audio.snapshot())
  }

  function selectWorld(entry: AlmanacWorld) {
    if (entry.id === selectedId()) return
    if (inspecting()) {
      runtime?.setBookInspection(false)
      setInspecting(false)
    }
    if (hasSpecimen() && runtime)
      savedViews.set(selectedId(), runtime.snapshot().settings)
    audio?.stop()
    setSelectedId(entry.id)
    if (isJourneyWorldId(entry.id)) journey.store.selectWorld(entry.id)
    const next = savedViews.get(entry.id) ?? settingsForWorld(world())
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

  createEffect(() => {
    const awards = earnedBookAwards(journey.snapshot().progress)
    untrack(() => runtime?.setBookAwards(awards))
  })

  onMount(() => {
    runtime = new BenchRuntime(canvas, update)
    audio = new MotifAudio(updateSound)
    updateSound()
    runtime.setBookAwards(earnedBookAwards(journey.snapshot().progress))
    runtime.setScene('book')
    runtime.setBookDock(world().id === 'tideweave' ? 'right' : 'left')
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
      data-page-status={pageStatus()}
    >
      <header class="almanac-header">
        <a
          class="almanac-brand"
          href="/"
          aria-label="Lumen Apeiron, return to XR lab"
        >
          <LogoMark />
          <span>Lumen Apeiron</span>
        </a>
        <h1 id="almanac-title">Almanac</h1>
        <a
          class="almanac-return-worlds lx-secondary"
          href={`/observatory?world=${returnWorld()}`}
        >
          <Icon name="left" />
          <span>Return to worlds</span>
        </a>
      </header>

      <div class="almanac-workspace">
        <section class="almanac-scene-toolbar" aria-label="Almanac pages">
          <p class="almanac-earned-count">
            <Icon name="book" />
            {earnedCount()} of 2 pages earned
          </p>
          <nav class="almanac-worlds" aria-label="World studies">
            <For each={studies}>
              {(entry) => (
                <button
                  type="button"
                  class="almanac-world"
                  data-world={entry.id}
                  aria-pressed={selectedId() === entry.id}
                  onClick={() => {
                    selectWorld(entry)
                  }}
                >
                  <span class="almanac-world-copy">
                    <strong>{entry.name}</strong>
                    <span>
                      {entry.tonic} {entry.mode}
                      <Show when={earned(entry.id)}> · Earned</Show>
                    </span>
                  </span>
                  <span
                    class="almanac-tab-mark"
                    classList={{ 'is-earned': earned(entry.id) }}
                    aria-hidden="true"
                  >
                    <Icon name={earned(entry.id) ? 'check' : 'star'} />
                  </span>
                </button>
              )}
            </For>
          </nav>
        </section>

        <section class="almanac-observatory" aria-labelledby="almanac-title">
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
                  class="lx-secondary"
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
                  class="lx-secondary"
                  type="button"
                  onClick={() => runtime?.retryBook()}
                >
                  Retry book
                </button>
              </div>
            </Show>
            <Show when={!hasSpecimen()}>
              <div class="almanac-unwritten">
                <span class="almanac-preview-numeral" aria-hidden="true">
                  {numerals[pageIndex()]}
                </span>
                <h3>An unwritten world</h3>
                <p>
                  This constellation has a direction, but no orb or motif yet.
                </p>
              </div>
            </Show>
            <Show
              when={
                hasSpecimen() &&
                (state()?.book.reliefStatus === 'error' ||
                  state()?.book.detail.status === 'error')
              }
            >
              <div class="almanac-detail-error" role="status">
                <p>
                  Some book details could not load. Your progress is unchanged.
                </p>
                <button
                  class="lx-secondary"
                  type="button"
                  onClick={() => runtime?.retryBook()}
                >
                  Retry page details
                </button>
              </div>
            </Show>
            <div class="almanac-stage-topline" aria-hidden="true">
              <span>Irchiinnuss</span>
              <span>Folio {numerals[pageIndex()]}</span>
            </div>
            <Show when={hasSpecimen()}>
              <div class="almanac-scene-bottom">
                <div class="almanac-orb-caption">
                  <span>{specimenName()}</span>
                  <p id="almanac-view-help" class="almanac-view-help">
                    Drag to turn. Scroll to zoom. Arrow keys turn the focused
                    view.
                  </p>
                </div>
                <div
                  class="almanac-camera-tools"
                  role="group"
                  aria-label="Almanac camera"
                >
                  <button
                    class="lx-secondary almanac-zoom"
                    type="button"
                    disabled={!ready()}
                    onClick={() =>
                      runtime?.setSettings({
                        distance: settings().distance + 0.3,
                      })
                    }
                    aria-label="Zoom out"
                  >
                    <Icon name="minus" />
                  </button>
                  <button
                    class="lx-secondary almanac-zoom"
                    type="button"
                    disabled={!ready()}
                    onClick={() =>
                      runtime?.setSettings({
                        distance: settings().distance - 0.3,
                      })
                    }
                    aria-label="Zoom in"
                  >
                    <Icon name="plus" />
                  </button>
                  <button
                    class="lx-secondary"
                    type="button"
                    disabled={!ready()}
                    onClick={() => runtime?.resetView()}
                  >
                    <Icon name="reset" />
                    <span>Reset view</span>
                  </button>
                  <button
                    class="lx-secondary almanac-material-control"
                    type="button"
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
                </div>
              </div>
            </Show>
          </div>
        </section>

        <nav class="almanac-horizons" aria-label="Seven constellation pages">
          <For each={ALMANAC_WORLDS}>
            {(entry, index) => (
              <button
                type="button"
                class="almanac-preview"
                data-playable={entry.status === 'study'}
                aria-pressed={selectedId() === entry.id}
                aria-label={
                  entry.status === 'study'
                    ? `Select page ${numerals[index()]}`
                    : `${entry.name}, preview`
                }
                aria-description={`${entry.name}, ${earned(entry.id) ? 'earned' : entry.status === 'preview' ? 'preview' : 'not yet earned'}`}
                onClick={() => {
                  selectWorld(entry)
                }}
              >
                <span class="almanac-page-numeral" aria-hidden="true">
                  {numerals[index()]}
                </span>
                <span class="almanac-strip-name">{entry.name}</span>
                <span class="almanac-strip-state">
                  {entry.status === 'preview'
                    ? 'Preview'
                    : earned(entry.id)
                      ? 'Earned'
                      : 'Not yet'}
                </span>
              </button>
            )}
          </For>
        </nav>

        <section
          class="almanac-listening-desk"
          aria-labelledby="almanac-world-title"
        >
          <div class="almanac-page-heading">
            <p class="lx-label">
              Page {numerals[pageIndex()]} ·{' '}
              {pageStatus() === 'earned'
                ? 'Earned'
                : pageStatus() === 'preview'
                  ? 'Preview'
                  : 'Not yet earned'}
            </p>
            <h2 id="almanac-world-title">{world().name}</h2>
            <span class="almanac-world-mode">
              {world().tonic} {world().mode}
              {world().status === 'preview' ? ' (proposed)' : ''}
            </span>
          </div>

          <div
            class="almanac-motif"
            classList={{ 'is-playing': sound()?.playing ?? false }}
          >
            <Show
              when={world().motif}
              fallback={
                <div class="almanac-motif-pending">
                  <strong>Preview: not playable in this build.</strong>
                  <p>The musical signature is still to be written.</p>
                </div>
              }
            >
              {(motif) => (
                <>
                  <div class="almanac-motif-heading">
                    <span>World motif</span>
                    <span>{motif().tempo} beats per minute</span>
                  </div>
                  <svg
                    class="almanac-phrase"
                    viewBox="0 0 320 116"
                    role="img"
                    aria-label={`Motif notes: ${motif()
                      .notes.map((note) => staffNote(note.midi).label)
                      .join(', ')}`}
                  >
                    <For each={[28, 38, 48, 58, 68]}>
                      {(y) => (
                        <path class="almanac-staff-line" d={`M4 ${y}H316`} />
                      )}
                    </For>
                    <text class="almanac-clef" x="7" y="68">
                      𝄞
                    </text>
                    <For each={motif().notes}>
                      {(note, index) => {
                        const notation = staffNote(note.midi)
                        const x =
                          56 +
                          index() *
                            (244 / Math.max(1, motif().notes.length - 1))
                        return (
                          <g
                            class="almanac-note"
                            classList={{
                              'is-active':
                                sound()?.activeNote === index() &&
                                Boolean(sound()?.playing),
                            }}
                          >
                            <For each={notation.ledgerSteps}>
                              {(step) => (
                                <path
                                  class="almanac-ledger"
                                  d={`M${x - 10} ${68 - step * 5}h20`}
                                />
                              )}
                            </For>
                            <ellipse
                              class="almanac-note-ring"
                              cx={x}
                              cy={notation.y}
                              rx="10"
                              ry="8"
                            />
                            <ellipse
                              class="almanac-note-head"
                              cx={x}
                              cy={notation.y}
                              rx="6"
                              ry="4.5"
                              transform={`rotate(-22 ${x} ${notation.y})`}
                            />
                            <path
                              class="almanac-note-stem"
                              d={
                                notation.stemDown
                                  ? `M${x - 5} ${notation.y}v28`
                                  : `M${x + 5} ${notation.y}v-28`
                              }
                            />
                            <Show when={notation.accidental}>
                              <text
                                class="almanac-accidental"
                                x={x - 19}
                                y={notation.y + 5}
                              >
                                {notation.accidental}
                              </text>
                            </Show>
                            <text
                              class="almanac-note-name"
                              x={x}
                              y="106"
                              text-anchor="middle"
                            >
                              {notation.label}
                            </text>
                          </g>
                        )
                      }}
                    </For>
                  </svg>
                  <div class="almanac-audio-controls">
                    <button
                      class="almanac-play lx-primary"
                      type="button"
                      onClick={playMotif}
                    >
                      <Icon
                        name={
                          sound()?.loading || sound()?.playing ? 'stop' : 'play'
                        }
                      />
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
                  </div>
                  <div class="almanac-motif-progress" aria-hidden="true">
                    <span
                      style={{ width: `${(sound()?.progress ?? 0) * 100}%` }}
                    />
                  </div>
                  <span class="almanac-playback-status" role="status">
                    {sound()?.loading
                      ? 'Opening audio…'
                      : sound()?.playing
                        ? 'Playing'
                        : 'Press play to listen'}
                  </span>
                </>
              )}
            </Show>
            <Show when={sound()?.error}>
              <p class="almanac-audio-error" role="alert">
                {sound()?.error}
              </p>
            </Show>
          </div>

          <Show when={hasSpecimen()}>
            <div
              class="almanac-collection-state"
              data-page-status={pageStatus()}
            >
              <div class="almanac-relief-heading">
                <h3>Raised on this page</h3>
                <span>
                  {completion()
                    ? 'Page earned'
                    : pageStatus() === 'discovered'
                      ? 'World discovered'
                      : 'Not yet visited'}
                </span>
              </div>
              <PageGlyph
                world={world().id === 'glasswake' ? 'glasswake' : 'tideweave'}
                earned={Boolean(completion())}
              />
              <p>
                {completion()
                  ? world().id === 'glasswake'
                    ? 'Three stars, raised on the left page. You opened the C, E and G seals.'
                    : 'Four gems and the D–F–B–A path, raised on the right page.'
                  : world().id === 'glasswake'
                    ? 'Not yet earned. Open three seals in Glasswake to raise its stars.'
                    : 'Not yet earned. Trace four notes in Tideweave to raise its melody path.'}
              </p>
              <span class="almanac-score-note">
                No singing score in this build.
              </span>
            </div>
          </Show>
          <div class="almanac-entry-copy">
            <p>{world().summary}</p>
            <Show when={world().id === 'tideweave'}>
              <p class="almanac-provisional">
                Thicket is a placeholder form while Tideweave takes shape.
              </p>
            </Show>
          </div>
          <Show when={hasSpecimen()}>
            <div class="almanac-page-actions">
              <button
                ref={inspectButton}
                class="almanac-inspect lx-secondary"
                type="button"
                disabled={!ready()}
                hidden={inspecting()}
                onClick={inspect}
              >
                <Icon name="globe" />
                Inspect orb
              </button>
              <Show when={inspecting()}>
                <button
                  ref={returnButton}
                  class="almanac-return lx-secondary"
                  type="button"
                  onClick={returnToBook}
                >
                  <Icon name="left" />
                  Return to Almanac <span>Esc</span>
                </button>
              </Show>
              <a class="lx-tertiary" href={`/observatory?world=${world().id}`}>
                Visit {world().name}
                <Icon name="right" />
              </a>
            </div>
          </Show>
          <footer class="almanac-footer">
            <JourneySaveStatus persistence={journey.snapshot().persistence} />
            <a class="lx-tertiary" href="/bench">
              Compare orb recipes
              <Icon name="right" />
            </a>
          </footer>
        </section>
      </div>
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
