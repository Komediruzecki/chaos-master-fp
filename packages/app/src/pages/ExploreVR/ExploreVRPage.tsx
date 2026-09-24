/**
 * Fullscreen cosmic atlas: the scene leads, and quiet corner instruments
 * reveal inspection, local discoveries and an optional guided passage.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { Bookmark, Check, ChevronLeft, ChevronRight, Cross, Eye, EyeOff, Focus, Info, Minus, Pause, PlayPause, Plus, Reset, } from '@/icons'
import ui from './ExploreVRPage.module.css'
import { ImmersiveAtlas } from './ImmersiveAtlas'
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
const BACKDROP = new URL('./assets/cosmic-nebula.webp', import.meta.url).href

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

/** The thin celestial mark belongs to this atlas's concept-art lockup. */
function AtlasMark() {
  return (
    <svg viewBox="0 0 56 56" fill="none" aria-hidden="true">
      <circle cx="28" cy="28" r="16" stroke="currentColor" stroke-width=".8" />
      <circle
        cx="28"
        cy="28"
        r="23"
        stroke="currentColor"
        stroke-width=".45"
        opacity=".3"
      />
      <path
        d="M28 1v19m0 16v19M1 28h19m16 0h19"
        stroke="currentColor"
        stroke-width=".8"
      />
      <circle cx="28" cy="28" r="2.3" fill="currentColor" />
    </svg>
  )
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
  const [isolated, setIsolated] = createSignal(false)
  const [details, setDetails] = createSignal(false)
  const [guided, setGuided] = createSignal(false)
  const [traveling, setTraveling] = createSignal(false)
  const [reducedMotion, setReducedMotion] = createSignal(false)
  const [visible, setVisible] = createSignal(!document.hidden)
  const [fullscreen, setFullscreen] = createSignal(false)
  let page: HTMLElement | undefined
  let scene: HTMLDivElement | undefined
  let inspectButton: HTMLButtonElement | undefined
  const collected = createMemo(() => discoveries().includes(selected().id))
  const index = createMemo(() =>
    ORB_PRESETS.findIndex((orb) => orb.id === selected().id),
  )
  const status = createMemo(() =>
    error()
      ? 'Captured world'
      : paused()
        ? 'Scene paused'
        : traveling()
          ? 'In passage'
          : ready()
            ? 'Live 3D flame'
            : 'Forming the flame…',
  )
  const renderDisabled = createMemo(() => !!error() || paused())

  function select(orb: OrbPreset, fromJourney = false) {
    if (!fromJourney) setGuided(false)
    if (selected().id === orb.id) return
    setReady(false)
    setSelected(orb)
    setNotice('')
    window.history.replaceState(null, '', `#${orb.id}`)
  }

  function next(direction: number, fromJourney = false) {
    const orb =
      ORB_PRESETS[
        (index() + direction + ORB_PRESETS.length) % ORB_PRESETS.length
      ]
    if (orb) select(orb, fromJourney)
  }

  createEffect(() => {
    if (!guided() || paused() || !visible() || traveling()) return
    void selected().id
    const timer = window.setTimeout(() => {
      next(1, true)
    }, 9000)
    onCleanup(() => {
      window.clearTimeout(timer)
    })
  })

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

  function closeDetails() {
    setDetails(false)
    inspectButton?.focus({ preventScroll: true })
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (page?.requestFullscreen) await page.requestFullscreen()
      else
        setNotice(
          'Fullscreen is unavailable in this browser. The atlas already fills this window.',
        )
    } catch {
      setNotice(
        'Fullscreen could not start. You can continue exploring in this window.',
      )
    }
  }

  onMount(() => {
    const oldTitle = document.title
    document.title = 'Irchiinnuss — Lumen Apeiron'
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const motion = () => setReducedMotion(media?.matches ?? false)
    const visibility = () => setVisible(!document.hidden)
    const followHash = () => {
      select(getOrbPreset(window.location.hash.slice(1)))
    }
    const full = () => setFullscreen(document.fullscreenElement === page)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && details()) closeDetails()
    }
    const interruptJourney = () => setGuided(false)
    const cameraKey = (event: KeyboardEvent) => {
      if (
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          '+',
          '-',
          '=',
        ].includes(event.key)
      )
        interruptJourney()
    }
    motion()
    media?.addEventListener('change', motion)
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('fullscreenchange', full)
    window.addEventListener('hashchange', followHash)
    window.addEventListener('keydown', escape)
    scene?.addEventListener('pointerdown', interruptJourney, true)
    scene?.addEventListener('wheel', interruptJourney, true)
    scene?.addEventListener('keydown', cameraKey, true)
    onCleanup(() => {
      document.title = oldTitle
      media?.removeEventListener('change', motion)
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('fullscreenchange', full)
      window.removeEventListener('hashchange', followHash)
      window.removeEventListener('keydown', escape)
      scene?.removeEventListener('pointerdown', interruptJourney, true)
      scene?.removeEventListener('wheel', interruptJourney, true)
      scene?.removeEventListener('keydown', cameraKey, true)
    })
  })

  return (
    <main
      ref={page}
      class={ui.page}
      style={{ '--orb-accent': selected().accent }}
      data-traveling={traveling()}
      data-paused={paused()}
      data-reduced-motion={reducedMotion()}
    >
      <img
        class={ui.nebula}
        src={BACKDROP}
        alt=""
        aria-hidden="true"
        fetchpriority="high"
      />
      <div class={ui.vignette} aria-hidden="true" />
      <div ref={scene} class={ui.scene}>
        <ImmersiveAtlas
          preset={selected()}
          posters={POSTERS}
          paused={paused()}
          reducedMotion={reducedMotion()}
          isolated={isolated()}
          resetKey={resetKey()}
          zoomStep={zoomStep()}
          ready={ready()}
          error={error()}
          onSelect={select}
          onReady={() => setReady(true)}
          onError={setError}
          onTravelChange={setTraveling}
        />
      </div>

      <header class={ui.header}>
        <a class={ui.brand} href="/" aria-label="Lumen Apeiron studio">
          <AtlasMark />
          <span>Lumen Apeiron</span>
          <i aria-hidden="true" />
        </a>
        <div class={ui.headerTools}>
          <button
            class={ui.journey}
            aria-pressed={guided()}
            aria-label={
              guided() ? 'End guided journey' : 'Start guided journey'
            }
            onClick={() => {
              const start = !guided()
              setGuided(start)
              if (start) setPaused(false)
            }}
          >
            <Show when={guided()} fallback={<PlayPause aria-hidden="true" />}>
              <Pause aria-hidden="true" />
            </Show>
            <span>{guided() ? 'End journey' : 'Guided journey'}</span>
          </button>
          <button
            class={ui.iconButton}
            aria-label={paused() ? 'Resume scene' : 'Pause scene'}
            aria-pressed={paused()}
            onClick={() => setPaused(!paused())}
          >
            <Show when={paused()} fallback={<Pause aria-hidden="true" />}>
              <PlayPause aria-hidden="true" />
            </Show>
          </button>
          <button
            class={ui.iconButton}
            aria-label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={() => void toggleFullscreen()}
          >
            <Focus aria-hidden="true" />
          </button>
          <a class={ui.studio} href="/" aria-label="Return to studio">
            <ChevronLeft aria-hidden="true" />
            <span>Studio</span>
          </a>
        </div>
      </header>

      <div class={ui.passage} aria-hidden="true" data-visible={traveling()}>
        <span>Crossing to</span>
        <strong>{selected().name}</strong>
        <i />
      </div>

      <footer class={ui.hud}>
        <div class={ui.identity}>
          <span class={ui.universeLabel}>The fractal universe</span>
          <h1>Irchiinnuss</h1>
          <div class={ui.identityRule} />
          <p>
            {discoveries().length} of {ORB_PRESETS.length} worlds kept
          </p>
        </div>
        <section class={ui.navigation} aria-label="Choose a world">
          <span class="sr-only" role="status">
            Selected world: {selected().name}
          </span>
          <div class={ui.routeLine} aria-hidden="true" />
          <button
            class={ui.step}
            aria-label="Previous world"
            onClick={() => {
              next(-1)
            }}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <For each={ORB_PRESETS}>
            {(orb) => (
              <button
                class={ui.world}
                aria-label={`Travel to ${orb.name}`}
                aria-pressed={selected().id === orb.id}
                title={orb.name}
                onClick={() => {
                  select(orb)
                }}
              >
                <img src={POSTERS[orb.id]} alt="" draggable={false} />
                <span class={ui.worldName}>{orb.name}</span>
                <Show when={discoveries().includes(orb.id)}>
                  <Check class={ui.saved} aria-label="Discovered" />
                </Show>
              </button>
            )}
          </For>
          <button
            class={ui.step}
            aria-label="Next world"
            onClick={() => {
              next(1)
            }}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </section>
        <div class={ui.destination}>
          <span
            class={ui.liveStatus}
            data-live={ready() && !paused() && !error() && !traveling()}
          >
            {status()}
          </span>
          <div class={ui.destinationHeading}>
            <h2>{selected().name}</h2>
            <button
              ref={inspectButton}
              class={ui.inspect}
              aria-label={
                details() ? 'Close world details' : 'Inspect world details'
              }
              aria-expanded={details()}
              aria-controls="atlas-inspector"
              onClick={() => setDetails(!details())}
            >
              <Info aria-hidden="true" />
            </button>
          </div>
          <p class={ui.hint}>
            {paused()
              ? 'Resume to continue exploring'
              : error()
                ? 'Select a world to explore'
                : 'Drag to orbit · Scroll to zoom'}
          </p>
        </div>
      </footer>

      <Show when={details()}>
        <aside
          id="atlas-inspector"
          class={ui.inspector}
          aria-label="World details"
        >
          <div class={ui.inspectorHeading}>
            <span>World {String(index() + 1).padStart(2, '0')} / 05</span>
            <button
              class={ui.iconButton}
              aria-label="Close details"
              onClick={closeDetails}
            >
              <Cross aria-hidden="true" />
            </button>
          </div>
          <h3>{selected().name}</h3>
          <p class={ui.subtitle}>{selected().subtitle}</p>
          <p class={ui.description}>{selected().description}</p>
          <div class={ui.recipe} aria-label="Flame variations">
            <For each={selected().recipe}>{(part) => <span>{part}</span>}</For>
          </div>
          <button
            class={ui.collect}
            aria-pressed={collected()}
            onClick={toggleDiscovery}
          >
            <Show when={collected()} fallback={<Bookmark aria-hidden="true" />}>
              <Check aria-hidden="true" />
            </Show>
            {collected() ? 'Discovered' : 'Keep this discovery'}
          </button>
          <div class={ui.tools}>
            <button
              aria-label="Zoom out"
              disabled={renderDisabled()}
              onClick={() => {
                setGuided(false)
                setZoomStep((step) => step - 1)
              }}
            >
              <Minus aria-hidden="true" />
            </button>
            <button
              aria-label="Zoom in"
              disabled={renderDisabled()}
              onClick={() => {
                setGuided(false)
                setZoomStep((step) => step + 1)
              }}
            >
              <Plus aria-hidden="true" />
            </button>
            <button
              disabled={!!error()}
              onClick={() => {
                setGuided(false)
                setResetKey((key) => key + 1)
              }}
            >
              <Reset aria-hidden="true" />
              Reset view
            </button>
            <button
              aria-pressed={isolated()}
              onClick={() => setIsolated(!isolated())}
            >
              <Show when={isolated()} fallback={<EyeOff aria-hidden="true" />}>
                <Eye aria-hidden="true" />
              </Show>
              {isolated() ? 'Show worlds' : 'Isolate world'}
            </button>
          </div>
          <p class={ui.detailHint}>
            Focus the flame for arrow-key orbiting and + / − zoom.
          </p>
          <a class={ui.deepZoom} href="/explore">
            Explore Mandelbrot <ChevronRight aria-hidden="true" />
          </a>
        </aside>
      </Show>
      <div class={ui.notice} role="status" data-visible={!!notice()}>
        {notice()}
      </div>
      <Show when={error()}>
        <div class={ui.gpuError} role="status">
          <span>
            Live rendering is unavailable. Explore the captured worlds.
          </span>
          <button
            onClick={() => {
              window.location.reload()
            }}
          >
            Reload renderer
          </button>
        </div>
      </Show>
      <Show when={guided() && !traveling()}>
        <div class={ui.journeyNote}>
          {paused()
            ? 'Journey paused'
            : 'A passage through five possible worlds'}
        </div>
      </Show>
    </main>
  )
}
