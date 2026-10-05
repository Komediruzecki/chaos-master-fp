/** A single gummy material and deformation study, isolated from the chess and flame documents. */
import { batch, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { GummyBearScene } from '@/components/GummyBear/GummyBearScene'
import { ParticleGummyBearScene } from '@/components/GummyBear/ParticleGummyBearScene'
import { Pause, PlayPause, Reset } from '@/icons'
import { isGummyChessMould } from '@/simulation/gummy/gummyChessMoulds'
import { GUMMY_JELLY_DEFAULT_FRAGILITY } from '@/simulation/gummy/gummyJellyFracture'
import { DEFAULT_GUMMY_PARTICLE_TUNING, normalizeGummyParticleTuning, } from '@/simulation/gummy/gummyParticleTuning'
import styles from './GummyBearPage.module.css'
import { GummyErrorNotice } from './GummyErrorNotice'
import { GummyPresetControls } from './GummyPresetControls'
import { GummyRecordingControls } from './GummyRecordingControls'
import { GUMMY_STUDY_LABELS, GummyStudyControls } from './GummyStudyControls'
import { GummyTuningControls } from './GummyTuningControls'
import { useGummyRecording } from './useGummyRecording'
import type { GummyPresetSettings } from './gummyPresets'
import type { GummyBearSceneProps, GummyExperiment, GummyGeometry, GummyInteraction, GummyPalette, GummyStudyStatus, GummySurface, } from '@/components/GummyBear/GummyBearScene'
import type { GummyJellyProtocol } from '@/components/GummyBear/gummyStudyMath'
import type { GummyParticleFixture } from '@/simulation/gummy/gummyParticleFixtures'
import type { GummyParticleTuning } from '@/simulation/gummy/gummyParticleTuning'

type GummyBenchModel = GummyExperiment | 'particle' | 'mpm'

function initialModel(): GummyBenchModel {
  const query = new URLSearchParams(window.location.search).get('experiment')
  return query === 'particle' ||
    query === 'mpm' ||
    query === 'pull' ||
    query === 'crush'
    ? query
    : 'jelly'
}

function initialFixture(): GummyParticleFixture {
  const query = new URLSearchParams(window.location.search).get('shape') ?? ''
  return isGummyChessMould(query) || query === 'blobs' ? query : 'bear'
}

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
  blobs?: boolean
  piece?: boolean
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
          {props.blobs
            ? 'Reset blobs'
            : props.piece
              ? 'Reset piece'
              : 'Reset bear'}
        </button>
      </div>
    </div>
  )
}

export function GummyBearPage() {
  const [experiment, setExperiment] =
    createSignal<GummyBenchModel>(initialModel())
  const [protocol, setProtocol] = createSignal<GummyJellyProtocol>('tear')
  const [palette, setPalette] = createSignal<GummyPalette>('marble')
  const [mode, setMode] = createSignal<GummyInteraction>(
    experiment() === 'crush' ? 'orbit' : 'drag',
  )
  const [softness, setSoftness] = createSignal(0.55)
  const [fragility, setFragility] = createSignal(GUMMY_JELLY_DEFAULT_FRAGILITY)
  const [tearResponse, setTearResponse] = createSignal<'soft' | 'crumble'>(
    'soft',
  )
  const [geometry, setGeometry] = createSignal<GummyGeometry>('fine')
  const [surface, setSurface] = createSignal<GummySurface>('rounded')
  const [particleMaterial, setParticleMaterial] = createSignal<
    'warm' | 'elastic'
  >('warm')
  const [particleFixture, setParticleFixture] =
    createSignal<GummyParticleFixture>(initialFixture())
  const [caustics, setCaustics] = createSignal(true)
  const [pointerGuide, setPointerGuide] = createSignal(true)
  const [tuning, setTuning] = createSignal<GummyParticleTuning>({
    ...DEFAULT_GUMMY_PARTICLE_TUNING,
  })
  const [grabRadius, setGrabRadius] = createSignal(0.22)
  const [maxPull, setMaxPull] = createSignal(1.8)
  const [pinnedFeet, setPinnedFeet] = createSignal(true)
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
  const recording = useGummyRecording()
  let canvasSlot: HTMLDivElement | undefined
  const continuous = createMemo(() => experiment() === 'jelly')
  const particle = createMemo(
    () => experiment() === 'particle' || experiment() === 'mpm',
  )
  const chessPiece = createMemo(
    () => particle() && isGummyChessMould(particleFixture()),
  )
  const presetSettings = createMemo<GummyPresetSettings>(() => ({
    palette: palette(),
    particleMaterial: particleMaterial(),
    softness: softness(),
    fragility: fragility(),
    tearing: tearing(),
    tuning: tuning(),
    grabRadius: grabRadius(),
    maxPull: maxPull(),
    pinnedFeet: pinnedFeet(),
    caustics: caustics(),
  }))
  const reconstruction = createMemo(() =>
    experiment() === 'mpm'
      ? ('marching-cubes' as const)
      : experiment() === 'particle'
        ? ('screen-space' as const)
        : undefined,
  )
  const tearProtocol = createMemo(() => continuous() && protocol() === 'tear')
  const existingExperiment = createMemo<GummyExperiment>(() => {
    const value = experiment()
    return value === 'particle' || value === 'mpm' ? 'jelly' : value
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
      ? particle()
        ? particleFixture() === 'blobs'
          ? 'Drag one blob toward the other, release, then pull it away.'
          : chessPiece()
            ? pinnedFeet()
              ? 'Base held. Pull the head or crown, release, then grab the fallen jelly.'
              : 'Free piece. Grab the head or crown and pull, or lift the whole piece.'
            : pinnedFeet()
              ? 'Feet held. Try a short pull, release, then grab the fallen jelly.'
              : 'Free bear. Grab and pull, then release to let it settle.'
        : continuous()
          ? tearProtocol()
            ? 'Body held. Grab an arm or ear, pull a little, then release.'
            : 'Grab and stretch the jelly. Release to watch it recover.'
          : experiment() === 'crush'
            ? 'Grab any part and pull, or run the press demo.'
            : 'Grab the arm or ear and pull. Release to watch it settle.'
      : mode() === 'pan'
        ? 'Drag to move the view. Scroll or pinch to move closer.'
        : 'Drag to turn around the bear. Scroll or pinch to move closer.',
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

  function applyPreset(settings: GummyPresetSettings) {
    batch(() => {
      setPalette(settings.palette)
      setParticleMaterial(settings.particleMaterial)
      setSoftness(settings.softness)
      setFragility(settings.fragility)
      setTearing(settings.tearing)
      setTuning({ ...settings.tuning })
      setGrabRadius(settings.grabRadius)
      setMaxPull(settings.maxPull)
      setPinnedFeet(settings.pinnedFeet)
      setCaustics(settings.caustics)
      reset()
    })
  }

  function selectTearResponse(next: 'soft' | 'crumble') {
    if (next === tearResponse()) return
    batch(() => {
      setTearResponse(next)
      reset()
    })
  }

  function selectParticleMaterial(next: 'warm' | 'elastic') {
    if (next === particleMaterial()) return
    batch(() => {
      setParticleMaterial(next)
      setGrabRadius(next === 'warm' ? 0.22 : 0.28)
      reset()
    })
  }

  function selectPinnedFeet(next: boolean) {
    if (next === pinnedFeet()) return
    batch(() => {
      setError(undefined)
      setPaused(false)
      setPinnedFeet(next)
    })
  }

  function restoreTuning() {
    batch(() => {
      setTuning({ ...DEFAULT_GUMMY_PARTICLE_TUNING })
      setGrabRadius(particleMaterial() === 'warm' ? 0.22 : 0.28)
      setMaxPull(1.8)
    })
  }

  function selectParticleFixture(next: GummyParticleFixture) {
    if ((!ready() && !error()) || next === particleFixture()) return
    batch(() => {
      setReady(false)
      setStatus('loading')
      setPaused(false)
      setError(undefined)
      setDemoKey(0)
      setResetKey(0)
      setParticleFixture(next)
    })
    const url = new URL(window.location.href)
    url.searchParams.set('shape', next)
    window.history.replaceState(window.history.state, '', url)
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
          next === 'mpm' ||
          (next === 'jelly' && protocol() === 'tear')
          ? 'drag'
          : 'orbit',
      )
      setExperiment(next)
    })
    const url = new URL(window.location.href)
    url.searchParams.set('experiment', next)
    window.history.replaceState(window.history.state, '', url)
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
        manual={tearProtocol() || particle()}
        blobs={particle() && particleFixture() === 'blobs'}
        piece={chessPiece()}
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

  function cameraControls() {
    return (
      <fieldset
        class={styles.fieldset}
        disabled={!ready() || !!error()}
        data-testid="gummy-camera-controls"
      >
        <legend>Camera &amp; touch</legend>
        <div
          class={`${styles.segments} ${styles.cameraModes}`}
          role="group"
          aria-label="Pointer action"
        >
          <For
            each={
              [
                { id: 'drag', label: 'Grab & pull' },
                { id: 'orbit', label: 'Orbit' },
                { id: 'pan', label: 'Pan' },
              ] as const
            }
          >
            {(choice) => (
              <button
                type="button"
                aria-pressed={mode() === choice.id}
                onClick={() => setMode(choice.id)}
              >
                {choice.label}
              </button>
            )}
          </For>
        </div>
        <p class={styles.note}>
          Right-drag to orbit. Shift-drag to pan. With two fingers, move to pan
          and pinch to zoom.
        </p>
        <label class={styles.check}>
          <input
            type="checkbox"
            checked={pointerGuide()}
            onChange={(event) => setPointerGuide(event.currentTarget.checked)}
          />
          <span>Pointer guide</span>
        </label>
        <p class={styles.note}>
          Cyan to aim. Amber while holding, with a line showing the pull.
          Included in recordings.
        </p>
      </fieldset>
    )
  }

  function recordingControls() {
    return (
      <GummyRecordingControls
        recording={recording}
        ready={ready() && !error()}
        onStart={() => {
          recording.start(canvasSlot?.querySelector('canvas'))
        }}
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
    get surface() {
      return surface()
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
    get recording() {
      return recording.busy()
    },
    get pointerGuide() {
      return pointerGuide()
    },
    onReady: (value) => {
      if (!value)
        recording.stop('Recording finished because the study changed.')
      setReady(value)
    },
    onStatus: setStatus,
    onError: (value) => {
      if (value) recording.stop()
      setError(value)
    },
    onPauseChange: setPaused,
    onReplay: () => {
      if (!tearProtocol() && !particle()) replay()
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
                ? experiment() === 'mpm'
                  ? 'MPM + marching cubes / 05'
                  : 'Particle jelly / 04'
                : continuous()
                  ? tearProtocol()
                    ? 'Manual tear / 03'
                    : 'Continuous jelly / 03'
                  : experiment() === 'crush'
                    ? 'Crush study / 02'
                    : 'Limb pull / 01'}
            </span>
            <span>
              {particle()
                ? GUMMY_STUDY_LABELS[particleFixture()]
                : 'Gummy bear'}
            </span>
          </div>
          <div class={styles.canvasSlot} ref={canvasSlot}>
            <Show
              when={reconstruction()}
              keyed
              fallback={
                <GummyBearScene
                  {...sceneProps}
                  experiment={existingExperiment()}
                  protocol={protocol()}
                />
              }
            >
              {(selected) => (
                <ParticleGummyBearScene
                  {...sceneProps}
                  reconstruction={selected}
                  caustics={caustics()}
                  particleMaterial={particleMaterial()}
                  fixture={particleFixture()}
                  tuning={tuning()}
                  grabRadius={grabRadius()}
                  maxPull={maxPull()}
                  pinnedFeet={pinnedFeet()}
                />
              )}
            </Show>
            <Show when={error()} keyed>
              {(message) => <GummyErrorNotice message={message} />}
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
            <Show when={compactControls()}>
              <div class={styles.studioTools}>
                {cameraControls()}
                {recordingControls()}
              </div>
            </Show>
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
          <Show when={!compactControls()}>
            {cameraControls()}
            {recordingControls()}
          </Show>
          <Show when={particle()}>
            <GummyPresetControls
              current={presetSettings()}
              onApply={applyPreset}
              disabled={!ready() || !!error()}
            />
            <p class={styles.paletteHelp}>
              <a class={styles.button} href="/gummy?view=board">
                Gummy chess board
              </a>
            </p>
            <GummyStudyControls
              fixture={particleFixture()}
              disabled={!ready() && !error()}
              onSelect={selectParticleFixture}
            />
          </Show>
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
            <fieldset
              class={styles.fieldset}
              disabled={!ready() || !!error()}
              aria-describedby="gummy-surface-help"
            >
              <legend>Torn surface</legend>
              <div class={styles.segments}>
                <button
                  type="button"
                  aria-pressed={surface() === 'original'}
                  onClick={() => setSurface('original')}
                >
                  Original
                </button>
                <button
                  type="button"
                  aria-pressed={surface() === 'rounded'}
                  onClick={() => setSurface('rounded')}
                >
                  Rounded
                </button>
              </div>
              <p id="gummy-surface-help" class={styles.note}>
                Round torn corners. Switch views without resetting the bear.
              </p>
            </fieldset>
          </Show>
          <fieldset class={styles.fieldset} disabled={!ready() || !!error()}>
            <legend>Material</legend>
            <Show when={particle()}>
              <div class={styles.responseControl}>
                <div
                  class={styles.segments}
                  role="group"
                  aria-label="Particle material"
                  aria-describedby="gummy-particle-material-help"
                >
                  <button
                    type="button"
                    aria-pressed={particleMaterial() === 'warm'}
                    onClick={() => {
                      selectParticleMaterial('warm')
                    }}
                  >
                    Warm jelly
                  </button>
                  <button
                    type="button"
                    aria-pressed={particleMaterial() === 'elastic'}
                    onClick={() => {
                      selectParticleMaterial('elastic')
                    }}
                  >
                    Elastic jelly
                  </button>
                </div>
                <p id="gummy-particle-material-help" class={styles.note}>
                  Warm jelly yields as you stretch it. Elastic jelly keeps the
                  earlier springy response. Switching resets the study.
                </p>
              </div>
            </Show>
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
            <Show
              when={
                tearProtocol() || (particle() && particleMaterial() === 'warm')
              }
            >
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
                ? particleMaterial() === 'warm'
                  ? 'Higher fragility softens stretched jelly sooner. Turn tearing off to compare how it yields without damage.'
                  : 'The earlier elastic response. Turn tearing off to compare its spring back, then reset before another pull.'
                : tearProtocol()
                  ? 'Higher fragility breaks connections sooner. Turn tearing off to compare the stretch.'
                  : continuous()
                    ? 'This motion keeps the jelly joined. Choose Pull to tear to test separation.'
                    : 'Reset to restore the bear before trying another pull or crush.'}
            </p>
            <Show when={experiment() === 'mpm'}>
              <label class={styles.check}>
                <input
                  type="checkbox"
                  checked={caustics()}
                  onChange={(event) => setCaustics(event.currentTarget.checked)}
                />
                <span>Floor caustics</span>
              </label>
              <p class={styles.note}>
                Colour the floor with light bent through the jelly.
              </p>
            </Show>
            <Show when={particle()}>
              <GummyTuningControls
                tuning={tuning()}
                onTuningChange={(patch) =>
                  setTuning((current) =>
                    normalizeGummyParticleTuning({ ...current, ...patch }),
                  )
                }
                grabRadius={grabRadius()}
                onGrabRadius={setGrabRadius}
                maxPull={maxPull()}
                onMaxPull={setMaxPull}
                pinnedFeet={pinnedFeet()}
                onPinnedFeet={selectPinnedFeet}
                warm={particleMaterial() === 'warm'}
                bear={particleFixture() !== 'blobs'}
                chessPiece={chessPiece()}
                disabled={!ready() || !!error()}
                onReset={restoreTuning}
              />
            </Show>
            <Show when={!particle() || particleFixture() !== 'blobs'}>
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
                Candy and Lagoon use layers that stretch with the gummy. Marble
                swirls flow with it, too.
              </p>
            </Show>
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
                aria-pressed={experiment() === 'particle'}
                onClick={() => {
                  selectExperiment('particle')
                }}
              >
                Particle jelly
              </button>
              <button
                type="button"
                aria-pressed={experiment() === 'mpm'}
                onClick={() => {
                  selectExperiment('mpm')
                }}
              >
                MPM + marching cubes
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
                ? experiment() === 'mpm'
                  ? 'Marching cubes builds a 3D surface around the same GPU particles. Switching models resets the study and keeps your material choices.'
                  : 'Drag the jelly by hand. Compare the material responses on the same bear or two free blobs.'
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
          <p class={styles.keys}>
            {tearProtocol() || particle()
              ? 'Keyboard: Space pauses, R resets the bear. Arrows orbit, Shift + arrows pan, + and − zoom. Home resets the view.'
              : 'Keyboard: Space pauses, D runs the demo, R resets the bear. Arrows orbit, Shift + arrows pan, + and − zoom. Home resets the view.'}
          </p>
        </aside>
      </div>
    </main>
  )
}
