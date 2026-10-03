/** A single gummy material and deformation study, isolated from the chess and flame documents. */
import { batch, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { GummyBearScene } from '@/components/GummyBear/GummyBearScene'
import { ParticleGummyBearScene } from '@/components/GummyBear/ParticleGummyBearScene'
import { Pause, PlayPause, Reset } from '@/icons'
import styles from './GummyBearPage.module.css'
import type { GummyBearSceneProps, GummyExperiment, GummyInteraction, GummyPalette, GummyStudyStatus, } from '@/components/GummyBear/GummyBearScene'
import type { GummyJellyProtocol } from '@/components/GummyBear/gummyStudyMath'

type GummyBenchModel = GummyExperiment | 'particle'

const PALETTES: readonly { id: GummyPalette; name: string; color: string }[] = [
  { id: 'blue', name: 'Blue', color: '#227ed2' },
  { id: 'amber', name: 'Amber', color: '#de941b' },
  { id: 'berry', name: 'Berry', color: '#b34e75' },
  {
    id: 'candy',
    name: 'Candy',
    color:
      'linear-gradient(to top, #de941b 0% 25%, #36a971 42% 62%, #db4e79 80%, #ad2854 100%)',
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    color:
      'linear-gradient(to top, #de941b 0% 25%, #28c4bd 42% 62%, #285bcf 80% 100%)',
  },
  {
    id: 'marble',
    name: 'Marble',
    color:
      'conic-gradient(from 35deg, #b34e75, #de941b 35%, #28c4bd 43% 48%, #922b5a 62%, #de941b 85%, #b34e75)',
  },
]

function GummyActions(props: {
  compact?: boolean
  ready: boolean
  error?: string
  paused: boolean
  replay: boolean
  action: 'squeeze' | 'stretch' | 'crush' | 'pull' | 'tear'
  onReplay: () => void
  onPause: () => void
  onReset: () => void
}) {
  return (
    <div
      class={styles.actions}
      classList={{ [styles.compactActions!]: !!props.compact }}
    >
      <button
        type="button"
        class={styles.primary}
        disabled={!props.ready || !!props.error}
        onClick={props.onReplay}
      >
        {props.replay ? `Replay ${props.action}` : `Demo ${props.action}`}
        <span aria-hidden="true">→</span>
      </button>
      <div class={styles.actionPair}>
        <button
          type="button"
          class={styles.button}
          disabled={!props.ready || !!props.error}
          onClick={props.onPause}
          aria-pressed={props.paused}
        >
          {props.paused ? <PlayPause /> : <Pause />}
          {props.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          class={styles.button}
          disabled={!props.ready && !props.error}
          onClick={props.onReset}
        >
          <Reset />
          Reset bear
        </button>
      </div>
    </div>
  )
}

export function GummyBearPage() {
  const [experiment, setExperiment] = createSignal<GummyBenchModel>('jelly')
  const [protocol, setProtocol] = createSignal<GummyJellyProtocol>('squeeze')
  const [palette, setPalette] = createSignal<GummyPalette>('marble')
  const [mode, setMode] = createSignal<GummyInteraction>('orbit')
  const [softness, setSoftness] = createSignal(0.55)
  const [tearing, setTearing] = createSignal(true)
  const [paused, setPaused] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [demoKey, setDemoKey] = createSignal(0)
  const [resetKey, setResetKey] = createSignal(0)
  const [viewKey, setViewKey] = createSignal(0)
  const [status, setStatus] = createSignal<GummyStudyStatus>('loading')
  const [error, setError] = createSignal<string>()
  const [reducedMotion, setReducedMotion] = createSignal(false)
  const [compactControls, setCompactControls] = createSignal(false)
  const continuous = createMemo(() => experiment() === 'jelly')
  const particle = createMemo(() => experiment() === 'particle')
  const existingExperiment = createMemo<GummyExperiment>(() => {
    const value = experiment()
    return value === 'particle' ? 'jelly' : value
  })
  const activeTearing = createMemo(() => !continuous() && tearing())
  const statusText = createMemo(() => {
    if (error()) return 'The study stopped'
    if (!ready()) return 'Preparing the gummy…'
    if (paused()) return 'Paused'
    if (status() === 'pulling') return 'Pulling the right arm'
    if (status() === 'crushing')
      return continuous() ? 'Squeezing the jelly' : 'Lowering the press'
    if (status() === 'stretching') return 'Stretching the jelly'
    if (status() === 'holding' && particle()) return 'Holding the pull'
    if (status() === 'holding')
      return continuous() && protocol() === 'stretch'
        ? 'Holding the stretch'
        : 'Holding compression'
    if (status() === 'retracting') return 'Raising the press'
    if (status() === 'settling') return 'Releasing and settling'
    if (status() === 'picking') return 'Finding your grip…'
    if (status() === 'dragging') return 'Release to let it settle'
    if (continuous())
      return protocol() === 'squeeze' ? 'Ready to squeeze' : 'Ready to stretch'
    return experiment() === 'crush' ? 'Ready to crush' : 'Ready to pull'
  })
  const actionName = createMemo(() =>
    particle()
      ? 'tear'
      : continuous()
        ? protocol()
        : experiment() === 'crush'
          ? 'crush'
          : 'pull',
  )
  const hint = createMemo(() =>
    mode() === 'drag'
      ? continuous()
        ? 'Grab and stretch the jelly. Release to watch it recover.'
        : experiment() === 'crush'
          ? 'Grab any part and pull, or run the press demo.'
          : 'Grab the arm or ear and pull. Release to watch it settle.'
      : 'Drag to turn the bear. Scroll or pinch to move closer.',
  )

  onMount(() => {
    const originalTitle = document.title
    document.title = 'Gummy Study · Lumen Apeiron'
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const compact = window.matchMedia('(max-width: 720px)')
    const update = () => setReducedMotion(preference.matches)
    const updateCompact = () => setCompactControls(compact.matches)
    update()
    updateCompact()
    preference.addEventListener('change', update)
    compact.addEventListener('change', updateCompact)
    onCleanup(() => {
      document.title = originalTitle
      preference.removeEventListener('change', update)
      compact.removeEventListener('change', updateCompact)
    })
  })

  function replay() {
    batch(() => {
      setPaused(false)
      setDemoKey((value) => value + 1)
    })
  }

  function reset() {
    batch(() => {
      setPaused(false)
      setError(undefined)
      setResetKey((value) => value + 1)
    })
  }

  function selectExperiment(next: GummyBenchModel) {
    if (next === experiment()) return
    batch(() => {
      setReady(false)
      setStatus('loading')
      setPaused(false)
      setError(undefined)
      setDemoKey(0)
      setResetKey(0)
      setMode(next === 'pull' || next === 'particle' ? 'drag' : 'orbit')
      setExperiment(next)
    })
  }

  function selectProtocol(next: GummyJellyProtocol) {
    if (next === protocol()) return
    batch(() => {
      setReady(false)
      setStatus('loading')
      setPaused(false)
      setError(undefined)
      setDemoKey(0)
      setResetKey(0)
      setMode(next === 'stretch' ? 'drag' : 'orbit')
      setProtocol(next)
    })
  }

  function actions(compact: boolean) {
    return (
      <GummyActions
        compact={compact}
        ready={ready()}
        error={error()}
        paused={paused()}
        replay={demoKey() > 0}
        action={actionName()}
        onReplay={replay}
        onPause={() => setPaused((value) => !value)}
        onReset={reset}
      />
    )
  }

  const sceneProps: Omit<GummyBearSceneProps, 'experiment' | 'protocol'> = {
    get palette() {
      return palette()
    },
    get mode() {
      return mode()
    },
    get softness() {
      return softness()
    },
    get tearing() {
      return activeTearing()
    },
    get paused() {
      return paused()
    },
    get demoKey() {
      return demoKey()
    },
    get resetKey() {
      return resetKey()
    },
    get resetViewKey() {
      return viewKey()
    },
    get reducedMotion() {
      return reducedMotion()
    },
    onReady: setReady,
    onStatus: setStatus,
    onError: setError,
    onPauseChange: setPaused,
    onReplay: replay,
    onReset: reset,
  }

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <a class={styles.brand} href="/">
          Lumen Apeiron
        </a>
        <nav aria-label="Other studies">
          <a href="/chess?view=study">Glass pawn</a>
          <a href="/figurines">Fractal figurines</a>
        </nav>
      </header>
      <div class={styles.layout}>
        <section
          class={styles.studio}
          aria-label="Gummy bear studio"
          data-ready={ready()}
        >
          <div class={styles.studioHeader}>
            <span>
              {particle()
                ? 'Particle jelly / 04'
                : continuous()
                  ? 'Continuous jelly / 03'
                  : experiment() === 'crush'
                    ? 'Crush study / 02'
                    : 'Limb pull / 01'}
            </span>
            <span>Gummy bear</span>
          </div>
          <div class={styles.canvasSlot}>
            <Show
              when={particle()}
              fallback={
                <GummyBearScene
                  {...sceneProps}
                  experiment={existingExperiment()}
                  protocol={protocol()}
                />
              }
            >
              <ParticleGummyBearScene {...sceneProps} />
            </Show>
          </div>
          <div class={styles.studioFooter}>
            <div
              class={styles.studioActions}
              data-testid="gummy-studio-actions"
              hidden={!compactControls()}
            >
              {actions(true)}
            </div>
            <p>{hint()}</p>
            <button
              type="button"
              class={styles.textButton}
              onClick={() => setViewKey((value) => value + 1)}
            >
              Reset view
            </button>
          </div>
        </section>
        <aside class={styles.controls} aria-label="Gummy controls">
          <p class={styles.eyebrow}>Gummy comparison</p>
          <h1>
            Put it
            <br />
            under pressure.
          </h1>
          <p class={styles.intro}>
            Squash and stretch a continuous jelly, then compare the material
            models.
          </p>
          <fieldset class={styles.fieldset}>
            <legend>Model</legend>
            <div
              class={`${styles.segments} ${styles.models}`}
              role="group"
              aria-label="Gummy model"
            >
              <button
                type="button"
                aria-pressed={continuous()}
                onClick={() => {
                  selectExperiment('jelly')
                }}
              >
                Continuous jelly
              </button>
              <button
                type="button"
                aria-pressed={particle()}
                onClick={() => {
                  selectExperiment('particle')
                }}
              >
                Particle jelly
              </button>
              <button
                type="button"
                aria-pressed={experiment() === 'crush'}
                onClick={() => {
                  selectExperiment('crush')
                }}
              >
                Fine crush
              </button>
              <button
                type="button"
                aria-pressed={experiment() === 'pull'}
                onClick={() => {
                  selectExperiment('pull')
                }}
              >
                Limb pull
              </button>
            </div>
            <p class={styles.note}>
              {particle()
                ? 'Pull the right arm, hold the load, then release.'
                : continuous()
                  ? 'A joined elastic volume bends and recovers under load.'
                  : experiment() === 'crush'
                    ? 'The bear rests on its back beneath the press. Smaller joined regions can separate.'
                    : 'The original limb seams, with feet anchored for pulling.'}
            </p>
          </fieldset>
          <Show when={continuous()}>
            <fieldset class={styles.fieldset} disabled={!ready() || !!error()}>
              <legend>Test motion</legend>
              <div
                class={styles.segments}
                role="group"
                aria-label="Jelly protocol"
              >
                <button
                  type="button"
                  aria-pressed={protocol() === 'squeeze'}
                  onClick={() => {
                    selectProtocol('squeeze')
                  }}
                >
                  Squeeze &amp; release
                </button>
                <button
                  type="button"
                  aria-pressed={protocol() === 'stretch'}
                  onClick={() => {
                    selectProtocol('stretch')
                  }}
                >
                  Stretch &amp; release
                </button>
              </div>
              <p class={styles.note}>
                Load for two seconds, hold for three, then release and watch it
                recover.
              </p>
            </fieldset>
          </Show>
          <div
            class={styles.status}
            role="status"
            aria-label="Gummy status"
            aria-live="polite"
          >
            <span class={styles.statusDot} data-ready={ready()} />
            {statusText()}
          </div>
          <div data-testid="gummy-sidebar-actions" hidden={compactControls()}>
            {actions(false)}
          </div>
          <fieldset class={styles.fieldset} disabled={!ready() || !!error()}>
            <legend>Interaction</legend>
            <div
              class={styles.segments}
              role="group"
              aria-label="Pointer action"
            >
              <button
                type="button"
                aria-pressed={mode() === 'drag'}
                onClick={() => setMode('drag')}
              >
                Grab & pull
              </button>
              <button
                type="button"
                aria-pressed={mode() === 'orbit'}
                onClick={() => setMode('orbit')}
              >
                Orbit
              </button>
            </div>
          </fieldset>
          <fieldset class={styles.fieldset} disabled={!ready() || !!error()}>
            <legend>Material</legend>
            <div
              class={styles.palettes}
              role="radiogroup"
              aria-label="Gummy palette"
              aria-describedby="gummy-layered-colors"
            >
              <For each={PALETTES}>
                {(choice) => (
                  <label
                    class={styles.palette}
                    data-active={palette() === choice.id}
                  >
                    <input
                      type="radio"
                      name="gummy-palette"
                      value={choice.id}
                      checked={palette() === choice.id}
                      onChange={() => setPalette(choice.id)}
                    />
                    <span
                      class={styles.swatch}
                      style={{ background: choice.color }}
                    />
                    <span>{choice.name}</span>
                  </label>
                )}
              </For>
            </div>
            <p id="gummy-layered-colors" class={styles.paletteHelp}>
              Candy and Lagoon use layers that stretch with the bear. Marble
              swirls flow with it, too.
            </p>
            <label class={styles.sliderLabel} for="gummy-softness">
              Softness<output>{Math.round(softness() * 100)}%</output>
            </label>
            <input
              id="gummy-softness"
              class={styles.slider}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={softness()}
              onInput={(event) =>
                setSoftness(Number(event.currentTarget.value))
              }
            />
            <label class={styles.check}>
              <input
                type="checkbox"
                checked={activeTearing()}
                disabled={continuous()}
                onChange={(event) => setTearing(event.currentTarget.checked)}
              />
              <span>Allow tearing</span>
            </label>
            <p class={styles.note}>
              {particle()
                ? 'Experimental particles soften as they stretch. Reset restores the bear.'
                : continuous()
                  ? 'This continuous elastic model squashes and stretches. It does not tear.'
                  : 'Reset to restore the bear before trying another pull or crush.'}
            </p>
          </fieldset>
          <Show when={error()}>
            {(message) => (
              <p class={styles.error} role="alert">
                {message()} Reset the bear to try again.
              </p>
            )}
          </Show>
          <p class={styles.keys}>
            Keyboard: Space to pause, D runs the demo, R to reset. Arrow keys
            turn the view; + and − zoom.
          </p>
        </aside>
      </div>
    </main>
  )
}
