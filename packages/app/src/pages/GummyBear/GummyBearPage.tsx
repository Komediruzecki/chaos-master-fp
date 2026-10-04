/** A single gummy material and deformation study, isolated from the chess and flame documents. */
import { batch, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { GummyBearScene } from '@/components/GummyBear/GummyBearScene'
import { ParticleGummyBearScene } from '@/components/GummyBear/ParticleGummyBearScene'
import { Pause, PlayPause, Reset } from '@/icons'
import { GUMMY_JELLY_DEFAULT_FRAGILITY } from '@/simulation/gummy/gummyJellyFracture'
import styles from './GummyBearPage.module.css'
import type { GummyBearSceneProps, GummyExperiment, GummyGeometry, GummyInteraction, GummyPalette, GummyStudyStatus, } from '@/components/GummyBear/GummyBearScene'
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
  manual?: boolean
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
      classList={{
        [styles.compactActions!]: !!props.compact,
        [styles.manualActions!]: !!props.manual,
      }}
    >
      <Show when={!props.manual}>
        <button
          type="button"
          class={styles.primary}
          disabled={!props.ready || !!props.error}
          onClick={props.onReplay}
        >
          {props.replay ? `Replay ${props.action}` : `Demo ${props.action}`}
          <span aria-hidden="true">→</span>
        </button>
      </Show>
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
  const [protocol, setProtocol] = createSignal<GummyJellyProtocol>('tear')
  const [palette, setPalette] = createSignal<GummyPalette>('marble')
  const [mode, setMode] = createSignal<GummyInteraction>('drag')
  const [softness, setSoftness] = createSignal(0.55)
  const [fragility, setFragility] = createSignal(GUMMY_JELLY_DEFAULT_FRAGILITY)
  const [tearResponse, setTearResponse] = createSignal<'soft' | 'crumble'>(
    'soft',
  )
  const [geometry, setGeometry] = createSignal<GummyGeometry>('fine')
  const [tearing, setTearing] = createSignal(true)
  const [jellyTearing, setJellyTearing] = createSignal(true)
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
  const tearProtocol = createMemo(() => continuous() && protocol() === 'tear')
  const existingExperiment = createMemo<GummyExperiment>(() => {
    const value = experiment()
    return value === 'particle' ? 'jelly' : value
  })
  const activeTearing = createMemo(() =>
    continuous() ? tearProtocol() && jellyTearing() : tearing(),
  )
  const continuousReady = createMemo(() =>
    protocol() === 'tear'
      ? 'Ready to tear'
      : protocol() === 'squeeze'
        ? 'Ready to squeeze'
        : 'Ready to stretch',
  )
  const statusText = createMemo(() => {
    if (error()) return 'The study stopped'
    if (!ready()) return 'Preparing the gummy…'
    if (paused()) return 'Paused'
    if (status() === 'pulling') return 'Pulling the right arm'
    if (status() === 'crushing')
      return continuous() ? 'Squeezing the jelly' : 'Lowering the press'
    if (status() === 'stretching') return 'Stretching the jelly'
    if (status() === 'holding' && (particle() || tearProtocol()))
      return 'Holding the pull'
    if (status() === 'holding')
      return continuous() && protocol() === 'stretch'
        ? 'Holding the stretch'
        : 'Holding compression'
    if (status() === 'retracting') return 'Raising the press'
    if (status() === 'settling') return 'Releasing and settling'
    if (status() === 'picking') return 'Finding your grip…'
    if (status() === 'dragging') return 'Release to let it settle'
    if (continuous()) return continuousReady()
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
        ? tearProtocol()
          ? 'Body held. Grab an arm or ear, pull a little, then release.'
          : 'Grab and stretch the jelly. Release to watch it recover.'
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

  function selectTearResponse(next: 'soft' | 'crumble') {
    if (next === tearResponse()) return
    batch(() => {
      setTearResponse(next)
      reset()
    })
  }

  function selectGeometry(next: GummyGeometry) {
    if ((!ready() && !error()) || next === geometry()) return
    batch(() => {
      setReady(false)
      setStatus('loading')
      setPaused(false)
      setError(undefined)
      setDemoKey(0)
      setResetKey(0)
      setGeometry(next)
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
      setMode(
        next === 'pull' ||
          next === 'particle' ||
          (next === 'jelly' && protocol() === 'tear')
          ? 'drag'
          : 'orbit',
      )
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
      setMode(next === 'stretch' || next === 'tear' ? 'drag' : 'orbit')
      setProtocol(next)
    })
  }

  function actions(compact: boolean) {
    return (
      <GummyActions
        compact={compact}
        manual={tearProtocol()}
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
    get fragility() {
      return fragility()
    },
    get tearResponse() {
      return tearResponse()
    },
    get geometry() {
      return geometry()
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
    onReplay: () => {
      if (!tearProtocol()) replay()
    },
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
                  ? tearProtocol()
                    ? 'Manual tear / 03'
                    : 'Continuous jelly / 03'
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
          <p class={styles.eyebrow}>Hot gummy</p>
          <h1>
            Pull it
            <br />
            apart.
          </h1>
          <p class={styles.intro}>
            Grab the gummy and pull. Adjust softness and fragility, then reset
            to compare.
          </p>
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
          <Show when={tearProtocol()}>
            <fieldset
              class={styles.fieldset}
              disabled={!ready() && !error()}
              aria-describedby="gummy-geometry-help"
            >
              <legend id="gummy-geometry-label">Geometry</legend>
              <div class={styles.segments}>
                <button
                  type="button"
                  aria-pressed={geometry() === 'standard'}
                  onClick={() => {
                    selectGeometry('standard')
                  }}
                >
                  Standard
                </button>
                <button
                  type="button"
                  aria-pressed={geometry() === 'fine'}
                  onClick={() => {
                    selectGeometry('fine')
                  }}
                >
                  Fine
                </button>
              </div>
              <p id="gummy-geometry-help" class={styles.note}>
                Fine adds detail to bending and torn edges. It takes more
                processing time. Changing geometry resets the bear.
              </p>
            </fieldset>
          </Show>
          <fieldset class={styles.fieldset} disabled={!ready() || !!error()}>
            <legend>Material</legend>
            <Show when={tearProtocol()}>
              <div class={styles.responseControl}>
                <span id="gummy-response-label" class={styles.sliderLabel}>
                  Tear response
                </span>
                <div
                  class={styles.segments}
                  role="group"
                  aria-labelledby="gummy-response-label"
                  aria-describedby="gummy-response-help"
                >
                  <button
                    type="button"
                    aria-pressed={tearResponse() === 'soft'}
                    onClick={() => {
                      selectTearResponse('soft')
                    }}
                  >
                    Soft tear
                  </button>
                  <button
                    type="button"
                    aria-pressed={tearResponse() === 'crumble'}
                    onClick={() => {
                      selectTearResponse('crumble')
                    }}
                  >
                    Crumble
                  </button>
                </div>
                <p id="gummy-response-help" class={styles.note}>
                  Soft tear stretches and holds some of the new shape. Crumble
                  breaks quickly into small pieces. Changing the response resets
                  the bear.
                </p>
              </div>
            </Show>
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
            <Show when={tearProtocol()}>
              <label class={styles.sliderLabel} for="gummy-fragility">
                Fragility<output>{Math.round(fragility() * 100)}%</output>
              </label>
              <input
                id="gummy-fragility"
                class={styles.slider}
                type="range"
                min="0"
                max="100"
                step="1"
                value={fragility() * 100}
                onInput={(event) =>
                  setFragility(Number(event.currentTarget.value) / 100)
                }
              />
            </Show>
            <label class={styles.check}>
              <input
                type="checkbox"
                checked={activeTearing()}
                disabled={continuous() && !tearProtocol()}
                onChange={(event) =>
                  continuous()
                    ? setJellyTearing(event.currentTarget.checked)
                    : setTearing(event.currentTarget.checked)
                }
              />
              <span>Allow tearing</span>
            </label>
            <p class={styles.note}>
              {particle()
                ? 'Experimental particles soften as they stretch. Reset restores the bear.'
                : tearProtocol()
                  ? 'Higher fragility breaks connections sooner. Turn tearing off to compare the stretch.'
                  : continuous()
                    ? 'This motion keeps the jelly joined. Choose Pull to tear to test separation.'
                    : 'Reset to restore the bear before trying another pull or crush.'}
            </p>
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
          </fieldset>
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
                  ? 'Grab, stretch or squeeze the body to test how it deforms.'
                  : experiment() === 'crush'
                    ? 'The bear rests on its back beneath the press. Smaller joined regions can separate.'
                    : 'The original limb seams, with feet anchored for pulling.'}
            </p>
          </fieldset>
          <Show when={continuous()}>
            <fieldset class={styles.fieldset} disabled={!ready() || !!error()}>
              <legend>Jelly action</legend>
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
                <button
                  type="button"
                  aria-pressed={protocol() === 'tear'}
                  onClick={() => {
                    selectProtocol('tear')
                  }}
                >
                  Pull to tear
                </button>
              </div>
              <p class={styles.note}>
                {tearProtocol()
                  ? 'Body held. Try a short pull by hand. Reset before testing another setting.'
                  : 'Load for two seconds, hold for three, then release and watch it recover.'}
              </p>
            </fieldset>
          </Show>
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
          <Show when={error()}>
            {(message) => (
              <p class={styles.error} role="alert">
                {message()} Reset the bear to try again.
              </p>
            )}
          </Show>
          <p class={styles.keys}>
            {tearProtocol()
              ? 'Keyboard: Space to pause, R to reset. Arrow keys turn the view; + and − zoom.'
              : 'Keyboard: Space to pause, D runs the demo, R to reset. Arrow keys turn the view; + and − zoom.'}
          </p>
        </aside>
      </div>
    </main>
  )
}
