/**
 * THESIS: a celestial atlas whose worlds are living 3D flame specimens.
 * OWN-WORLD: Lumen's dark gallery, pale instrument text, fine orbital rules.
 * STORY: choose a world, turn it in space, and keep a personal discovery log.
 * FIRST VIEWPORT: sparse copy left; a large specimen and satellites right;
 * a linear itinerary below provides the same choices without spatial input.
 * FORM: orbital atlas, explicitly delegated by the user; no headset required.
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { Bookmark, Check, ChevronLeft, ChevronRight, LumenMark, Minus, Pause, PlayPause, Plus, Reset, } from '@/icons'
import { AtlasStars } from './AtlasStars'
import ui from './ExploreVRPage.module.css'
import { FlameOrb } from './FlameOrb'
import { getOrbPreset, ORB_PRESETS } from './orbPresets'
import type { OrbPreset } from './orbPresets'

const LOG_KEY = 'chaos-master-fractal-atlas-discoveries-v1'
const POSTERS: Record<string, string> = {
  sol: new URL('./assets/sol.webp', import.meta.url).href,
  verdant: new URL('./assets/verdant.webp', import.meta.url).href,
  ember: new URL('./assets/ember.webp', import.meta.url).href,
  tide: new URL('./assets/tide.webp', import.meta.url).href,
  irchiinnuss: new URL('./assets/irchiinnuss.webp', import.meta.url).href,
}

function readLog(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]')
    return Array.isArray(value)
      ? ORB_PRESETS.filter((orb) => value.includes(orb.id)).map((orb) => orb.id)
      : []
  } catch {
    return []
  }
}

export function ExploreVRPage() {
  const [selected, setSelected] = createSignal(
    getOrbPreset(window.location.hash.slice(1)),
  )
  const [paused, setPaused] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [resetKey, setResetKey] = createSignal(0)
  const [zoomStep, setZoomStep] = createSignal(0)
  const [discoveries, setDiscoveries] = createSignal(readLog())
  const [notice, setNotice] = createSignal('')
  const [focused, setFocused] = createSignal(false)
  const collected = createMemo(() => discoveries().includes(selected().id))
  const index = createMemo(() =>
    ORB_PRESETS.findIndex((orb) => orb.id === selected().id),
  )
  const status = createMemo(() =>
    error()
      ? 'Preview image'
      : paused()
        ? 'Rendering paused'
        : ready()
          ? 'Live 3D flame'
          : 'Forming the flame…',
  )
  const inputHint = createMemo(() =>
    error()
      ? 'Captured preview · Select a world to explore'
      : paused()
        ? 'Resume rendering to orbit or zoom'
        : 'Drag / arrow keys to orbit · Scroll / − / + to zoom',
  )

  function select(orb: OrbPreset) {
    if (selected().id === orb.id) return
    setReady(false)
    setSelected(orb)
    setPaused(false)
    setNotice('')
    window.history.replaceState(null, '', `#${orb.id}`)
  }

  function next(direction: number) {
    const orb =
      ORB_PRESETS[
        (index() + direction + ORB_PRESETS.length) % ORB_PRESETS.length
      ]
    if (orb) select(orb)
  }

  function toggleDiscovery() {
    const orb = selected()
    const wasCollected = collected()
    const nextLog = wasCollected
      ? discoveries().filter((id) => id !== orb.id)
      : [...discoveries(), orb.id]
    setDiscoveries(nextLog)
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(nextLog))
      setNotice(
        wasCollected
          ? `${orb.name} removed from your discoveries.`
          : `${orb.name} saved on this device.`,
      )
    } catch {
      setNotice(
        'Storage is unavailable. Your discoveries will last for this visit.',
      )
    }
  }

  onMount(() => {
    const oldTitle = document.title
    document.title = 'Fractal Atlas — Lumen Apeiron'
    const followHash = () => {
      select(getOrbPreset(window.location.hash.slice(1)))
    }
    window.addEventListener('hashchange', followHash)
    onCleanup(() => {
      document.title = oldTitle
      window.removeEventListener('hashchange', followHash)
    })
  })

  return (
    <main
      class={ui.page}
      style={{ '--orb-accent': selected().accent }}
      data-focused={focused()}
    >
      <AtlasStars class={ui.stars} />
      <header class={ui.header}>
        <a class={ui.brand} href="/" aria-label="Lumen Apeiron studio">
          <LumenMark aria-hidden="true" />
          <span>Lumen Apeiron</span>
        </a>
        <div class={ui.headerTitle}>
          Fractal atlas <span>Desktop study</span>
        </div>
        <a class={ui.back} href="/">
          <ChevronLeft aria-hidden="true" /> Studio
        </a>
      </header>

      <section class={ui.experience} aria-label="Irchiinnuss orbital atlas">
        <div class={ui.intro}>
          <p class={ui.kicker}>An atlas of possible worlds</p>
          <h1>
            Beyond the <br />
            familiar universe.
          </h1>
          <p class={ui.introText}>
            Follow an orbit into Irchiinnuss. Every world is a flame; every turn
            reveals another pattern.
          </p>
          <span class={ui.edition}>Five worlds. One small beginning.</span>
        </div>

        <div class={ui.system}>
          <div class={ui.orbits} aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
          <div class={ui.specimen}>
            <img
              class={ui.heroPoster}
              style={{ visibility: ready() && !error() ? 'hidden' : 'visible' }}
              src={POSTERS[selected().id]}
              alt=""
              aria-hidden="true"
            />
            <Show when={!error()}>
              <FlameOrb
                class={ui.liveOrb}
                preset={selected()}
                paused={paused()}
                resetKey={resetKey()}
                zoomStep={zoomStep()}
                onReady={() => {
                  setReady(true)
                }}
                onError={(message) => {
                  setError(message)
                }}
              />
            </Show>
          </div>
          <For each={ORB_PRESETS}>
            {(orb, order) => (
              <button
                class={ui.satellite}
                data-position={order()}
                data-selected={selected().id === orb.id}
                aria-label={`Inspect ${orb.name}`}
                aria-pressed={selected().id === orb.id}
                onClick={() => {
                  select(orb)
                }}
                style={{ '--satellite-accent': orb.accent }}
              >
                <img src={POSTERS[orb.id]} alt="" draggable={false} />
                <span>{orb.name}</span>
              </button>
            )}
          </For>
          <div class={ui.specimenCaption}>
            <span
              class={ui.liveStatus}
              data-live={ready() && !paused() && !error()}
            >
              {status()}
            </span>
            <span>{inputHint()}</span>
          </div>
        </div>

        <aside class={ui.inspector} aria-label="Selected world">
          <p class={ui.worldType}>{selected().subtitle}</p>
          <h2>{selected().name}</h2>
          <p class={ui.description}>{selected().description}</p>
          <div class={ui.recipe} aria-label="Flame variations">
            <For each={selected().recipe}>{(part) => <span>{part}</span>}</For>
          </div>
          <button
            class={ui.collect}
            onClick={toggleDiscovery}
            aria-pressed={collected()}
          >
            <Show when={collected()} fallback={<Bookmark aria-hidden="true" />}>
              <Check aria-hidden="true" />
            </Show>
            {collected() ? 'Discovered' : 'Keep this discovery'}
          </button>
          <p class={ui.notice} role="status">
            {notice()}
          </p>
        </aside>
      </section>

      <section class={ui.navigation} aria-label="Choose a world">
        <span class="sr-only" role="status">
          Selected world: {selected().name}
        </span>
        <div class={ui.routeHeading}>
          <span>Your passage through Irchiinnuss</span>
          <span>
            {discoveries().length} / {ORB_PRESETS.length} discovered
          </span>
        </div>
        <div class={ui.itinerary}>
          <button
            class={ui.step}
            aria-label="Previous world"
            onClick={() => {
              next(-1)
            }}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <div class={ui.worlds}>
            <For each={ORB_PRESETS}>
              {(orb, order) => (
                <button
                  class={ui.world}
                  aria-pressed={selected().id === orb.id}
                  onClick={() => {
                    select(orb)
                  }}
                >
                  <span class={ui.worldNumber}>
                    {String(order() + 1).padStart(2, '0')}
                  </span>
                  <span>{orb.name}</span>
                  <Show when={discoveries().includes(orb.id)}>
                    <Check class={ui.savedMark} aria-label="Discovered" />
                  </Show>
                </button>
              )}
            </For>
          </div>
          <button
            class={ui.step}
            aria-label="Next world"
            onClick={() => {
              next(1)
            }}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </section>

      <footer class={ui.footer}>
        <p>
          Fictional worlds, real flame mathematics.{' '}
          <a href="/explore">Explore Mandelbrot</a>
        </p>
        <div class={ui.tools}>
          <button
            aria-pressed={focused()}
            onClick={() => {
              setFocused(!focused())
            }}
          >
            {focused() ? 'Show orbits' : 'Isolate world'}
          </button>
          <button
            aria-label="Zoom out"
            disabled={!!error() || paused()}
            onClick={() => {
              setZoomStep((step) => step - 1)
            }}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            aria-label="Zoom in"
            disabled={!!error() || paused()}
            onClick={() => {
              setZoomStep((step) => step + 1)
            }}
          >
            <Plus aria-hidden="true" />
          </button>
          <button
            disabled={!!error()}
            onClick={() => {
              setPaused(false)
              setResetKey((key) => key + 1)
            }}
          >
            <Reset aria-hidden="true" /> Reset view
          </button>
          <button
            disabled={!!error()}
            aria-pressed={paused()}
            onClick={() => {
              setPaused(!paused())
            }}
          >
            <Show when={paused()} fallback={<Pause aria-hidden="true" />}>
              <PlayPause aria-hidden="true" />
            </Show>
            {paused() ? 'Resume rendering' : 'Pause rendering'}
          </button>
        </div>
      </footer>
      <Show when={error()}>
        <div class={ui.gpuError} role="status">
          <p>
            Live rendering is unavailable. You can still explore the captured
            worlds.
          </p>
          <p>{error()}</p>
          <button
            onClick={() => {
              window.location.reload()
            }}
          >
            Reload renderer
          </button>
        </div>
      </Show>
    </main>
  )
}
