// Full-screen desktop observatory joins two live worlds to one forgiving spatial melody exercise.
import './observatory.css'
import { createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { ALMANAC_WORLDS } from '../almanac/catalog'
import { MotifAudio } from '../almanac/motifAudio'
import { beginTrace, BRIDGE_MOTIF, BRIDGE_NOTE_NAMES, BRIDGE_TARGET, createEncounter, endTrace, moveTrace, traceHint, } from './encounter'
import { ObservatoryRuntime } from './runtime'
import { pitchForTraceHeight } from './traceAudio'
import type { EncounterState, TracePoint } from './encounter'
import type { ObservatoryInput, ObservatorySnapshot, ObservatoryView, WorldId, } from './scene'

type ExerciseStage = 'listen' | 'listening' | 'answer' | 'complete'
const studies = ALMANAC_WORLDS.filter((world) => world.status === 'study')
const previews = ALMANAC_WORLDS.filter((world) => world.status === 'preview')

export function Observatory() {
  let canvas!: HTMLCanvasElement
  let atlasToggle!: HTMLButtonElement
  let runtime: ObservatoryRuntime | undefined
  let audio: MotifAudio | undefined
  const heldKeys = new Set<string>()
  let keyboardFrame = 0
  let keyboardTime = 0
  const [state, setState] = createSignal<ObservatorySnapshot>()
  const [sound, setSound] = createSignal<ReturnType<MotifAudio['snapshot']>>()
  const [worldId, setWorldId] = createSignal<WorldId>('glasswake')
  const [view, setView] = createSignal<ObservatoryView>('overview')
  const [atlasOpen, setAtlasOpen] = createSignal(false)
  const [exercise, setExercise] = createSignal(false)
  const [stage, setStage] = createSignal<ExerciseStage>('listen')
  const [encounter, setEncounter] = createSignal(createEncounter())
  const [motion, setMotion] = createSignal(true)
  const [keyboard, setKeyboard] = createSignal(false)
  const [cursor, setCursor] = createSignal<TracePoint>(BRIDGE_TARGET[0])
  const [collected, setCollected] = createSignal(false)
  const [traceSound, setTraceSound] = createSignal(true)
  const world = createMemo(
    () => studies.find((entry) => entry.id === worldId())!,
  )
  const ready = createMemo(() => Boolean(state()?.ready))
  const cursorProjection = createMemo(() => {
    state()
    return runtime?.projectTrace(cursor())
  })

  function presentTrace() {
    runtime?.setTrace({
      phase:
        !exercise() || stage() === 'listen'
          ? 'idle'
          : stage() === 'listening'
            ? 'demo'
            : stage() === 'complete'
              ? 'complete'
              : 'answer',
      target: BRIDGE_TARGET,
      response: encounter().response,
      acceptedSegments: encounter().accepted,
      segmentCount: BRIDGE_TARGET.length,
    })
  }

  function updateSound() {
    if (!audio) return
    const next = audio.snapshot()
    setSound(next)
    if (exercise()) {
      if (next.playing && next.motifId === BRIDGE_MOTIF.id)
        setStage('listening')
      else if (!next.playing && next.progress === 1)
        setStage(encounter().accepted === 4 ? 'complete' : 'answer')
      else if (!next.playing && !next.loading && stage() === 'listening')
        setStage('listen')
      presentTrace()
    }
  }

  function selectWorld(id: WorldId) {
    stopKeyboard()
    setExercise(false)
    audio?.stop()
    setWorldId(id)
    setView('overview')
    setAtlasOpen(false)
    runtime?.selectWorld(id)
    runtime?.setView('overview')
    presentTrace()
  }

  function leaveCrossing() {
    stopKeyboard()
    setExercise(false)
    audio?.stop()
    setEncounter(endTrace(encounter()))
    setView('overview')
    runtime?.setView('overview')
    presentTrace()
    canvas.focus({ preventScroll: true })
  }

  function playPhrase() {
    stopKeyboard()
    setEncounter(endTrace(encounter()))
    setStage('listen')
    void audio?.play(BRIDGE_MOTIF)
    presentTrace()
  }

  function openCrossing() {
    setAtlasOpen(false)
    setExercise(true)
    setView('trace')
    setKeyboard(false)
    runtime?.setView('trace')
    playPhrase()
  }

  function acceptInput(event: ObservatoryInput) {
    if (
      event.kind === 'trace' &&
      (event.phase === 'end' || event.phase === 'cancel')
    )
      audio?.stopTrace()
    if (document.hidden || atlasOpen() || !ready()) return
    if (event.kind === 'world') {
      selectWorld(event.worldId)
      return
    }
    if (!exercise() || stage() !== 'answer') return
    stopKeyboard()
    setKeyboard(false)
    const before = encounter()
    if (event.phase === 'end' || event.phase === 'cancel')
      setEncounter(endTrace(encounter()))
    else if (event.point) {
      setEncounter(
        event.phase === 'start'
          ? beginTrace(encounter(), event.point)
          : moveTrace(encounter(), event.point),
      )
    } else setEncounter(endTrace(encounter(), 'outside'))
    syncTraceSound(before, event.point, event.phase === 'start')
    finishInput()
  }

  function syncTraceSound(
    before: EncounterState,
    point: TracePoint | null,
    start = false,
  ) {
    const next = encounter()
    if (!traceSound()) {
      audio?.stopTrace()
      return
    }
    if (
      next.accepted === BRIDGE_TARGET.length &&
      next.accepted > before.accepted
    ) {
      audio?.finishTrace(BRIDGE_MOTIF.notes.at(-1)!.midi)
      return
    }
    const midi = point ? pitchForTraceHeight(point[1]) : null
    if (!next.drawing || midi === null) {
      audio?.stopTrace()
      return
    }
    const earnedMidi =
      next.accepted > before.accepted
        ? BRIDGE_MOTIF.notes[next.accepted - 1].midi
        : undefined
    if (start) void audio?.startTrace(midi, earnedMidi)
    else audio?.updateTrace(midi, earnedMidi)
  }

  function finishInput() {
    if (encounter().accepted === BRIDGE_TARGET.length) {
      setStage('complete')
      setCollected(true)
    }
    presentTrace()
  }

  function useKeyboard() {
    if (!ready() || document.hidden) return
    stopKeyboard()
    audio?.stopTrace()
    setKeyboard(true)
    setEncounter(endTrace(encounter()))
    setCursor(BRIDGE_TARGET[Math.max(0, encounter().accepted - 1)])
    canvas.focus({ preventScroll: true })
    presentTrace()
  }

  function stopKeyboard() {
    heldKeys.clear()
    cancelAnimationFrame(keyboardFrame)
    keyboardFrame = 0
  }

  function interruptInput() {
    stopKeyboard()
    audio?.stopTrace()
    setEncounter(endTrace(encounter()))
    // Toggling activity releases a captured pointer without changing the view.
    runtime?.setActive(false)
    if (!document.hidden) runtime?.setActive(true)
    presentTrace()
  }

  function closeAtlas() {
    setAtlasOpen(false)
    queueMicrotask(() => {
      atlasToggle.focus({ preventScroll: true })
    })
  }

  function moveKeyboard(time: number) {
    keyboardFrame = 0
    if (
      !heldKeys.size ||
      !exercise() ||
      !ready() ||
      document.hidden ||
      atlasOpen() ||
      stage() !== 'answer' ||
      document.activeElement !== canvas
    )
      return
    const delta =
      Math.min(0.035, Math.max(0, (time - keyboardTime) / 1000)) * 0.42
    keyboardTime = time
    const dx =
      Number(heldKeys.has('ArrowRight')) - Number(heldKeys.has('ArrowLeft'))
    const dy =
      Number(heldKeys.has('ArrowDown')) - Number(heldKeys.has('ArrowUp'))
    const next: TracePoint = [
      Math.max(0, Math.min(1, cursor()[0] + dx * delta)),
      Math.max(0, Math.min(1, cursor()[1] + dy * delta)),
    ]
    setCursor(next)
    const before = encounter()
    if (encounter().drawing) setEncounter(moveTrace(encounter(), next))
    syncTraceSound(before, next)
    finishInput()
    keyboardFrame = requestAnimationFrame(moveKeyboard)
  }

  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (atlasOpen() || exercise() || view() === 'inspect') {
        event.preventDefault()
        event.stopPropagation()
      }
      if (atlasOpen()) closeAtlas()
      else if (exercise()) leaveCrossing()
      else if (view() === 'inspect') {
        setView('overview')
        runtime?.setView('overview')
      }
      return
    }
    if (
      event.target !== canvas ||
      !exercise() ||
      !ready() ||
      document.hidden ||
      atlasOpen() ||
      stage() !== 'answer'
    )
      return
    if (
      !['Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
        event.key,
      )
    )
      return
    event.preventDefault()
    event.stopPropagation()
    if (!keyboard()) useKeyboard()
    if (event.key === 'Enter') {
      if (!event.repeat) {
        const before = encounter()
        setEncounter(
          encounter().drawing
            ? endTrace(encounter())
            : beginTrace(encounter(), cursor()),
        )
        syncTraceSound(before, cursor(), !before.drawing)
      }
    } else {
      heldKeys.add(event.key)
      if (!keyboardFrame) {
        keyboardTime = window.performance.now()
        keyboardFrame = requestAnimationFrame(moveKeyboard)
      }
    }
    finishInput()
  }

  onMount(() => {
    audio = new MotifAudio(updateSound)
    runtime = new ObservatoryRuntime(canvas, {
      changed: () => {
        if (runtime) {
          const next = runtime.snapshot()
          setState(next)
          if (next.error) {
            stopKeyboard()
            audio?.stopTrace()
            setEncounter(endTrace(encounter()))
          }
        }
      },
      input: acceptInput,
      music: () => {
        const snapshot = audio?.snapshot()
        return snapshot
          ? { ...snapshot, playing: snapshot.playing || snapshot.trace.active }
          : {
              playing: false,
              level: 0,
              activeNote: null,
              progress: 0,
            }
      },
    })
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduceMotion = () => {
      if (preference.matches) {
        setMotion(false)
        runtime?.setMotion(false)
      }
    }
    reduceMotion()
    preference.addEventListener('change', reduceMotion)
    const releaseKey = (event: KeyboardEvent) => heldKeys.delete(event.key)
    const visibility = () => {
      if (document.hidden) interruptInput()
      else runtime?.setActive(true)
    }
    window.addEventListener('keyup', releaseKey)
    window.addEventListener('blur', interruptInput)
    document.addEventListener('visibilitychange', visibility)
    canvas.addEventListener('blur', interruptInput)
    canvas.addEventListener('keydown', keyDown, true)
    updateSound()
    presentTrace()
    void runtime.init()
    if (import.meta.env.DEV)
      window.__observatory = {
        runtime,
        audio,
        get encounter() {
          return encounter()
        },
        get exerciseStage() {
          return stage()
        },
      }
    onCleanup(() => {
      preference.removeEventListener('change', reduceMotion)
      window.removeEventListener('keyup', releaseKey)
      window.removeEventListener('blur', interruptInput)
      document.removeEventListener('visibilitychange', visibility)
      canvas.removeEventListener('blur', interruptInput)
      canvas.removeEventListener('keydown', keyDown, true)
      stopKeyboard()
      audio?.dispose()
      runtime?.dispose()
      if (import.meta.env.DEV) delete window.__observatory
    })
  })

  return (
    <main
      class="observatory"
      classList={{ 'is-exercise': exercise() }}
      data-world={worldId()}
      onKeyDown={keyDown}
    >
      <canvas
        ref={canvas}
        class="observatory-canvas"
        tabIndex={0}
        aria-describedby={exercise() ? 'observatory-trace-help' : undefined}
        aria-label={
          exercise()
            ? 'Tideweave melody ribbon. Use keyboard controls below, or drag through the notes.'
            : 'Irchiinnuss observatory. Drag to turn the view and scroll to move closer.'
        }
      />
      <div class="observatory-shade" aria-hidden="true" />
      <header class="observatory-header">
        <a class="observatory-brand" href="/almanac">
          <span aria-hidden="true" class="observatory-brand-mark" />
          <span>Lumen Apeiron</span>
        </a>
        <nav aria-label="Observatory navigation">
          <button
            ref={atlasToggle}
            type="button"
            aria-expanded={atlasOpen()}
            aria-controls="observatory-atlas"
            onClick={() => {
              interruptInput()
              if (atlasOpen()) closeAtlas()
              else setAtlasOpen(true)
            }}
          >
            Seven constellations
          </button>
          <a href="/almanac">Almanac</a>
        </nav>
      </header>

      <Show when={!ready() && !state()?.error}>
        <div class="observatory-loading" role="status">
          Opening the observatory…
        </div>
      </Show>
      <Show when={state()?.error}>
        <div class="observatory-error" role="alert">
          <h2>The observatory could not open</h2>
          <p>{state()?.error}</p>
          <button
            type="button"
            onClick={() => {
              window.location.reload()
            }}
          >
            Reload scene
          </button>
        </div>
      </Show>
      <Show
        when={
          ready() && state()?.assets.some((asset) => asset.status === 'error')
        }
      >
        <div class="observatory-asset-error" role="alert">
          Some objects could not load.{' '}
          <button type="button" onClick={() => runtime?.retryAssets()}>
            Retry objects
          </button>
        </div>
      </Show>

      <Show when={atlasOpen()}>
        <aside
          id="observatory-atlas"
          class="observatory-atlas"
          aria-label="Seven constellations"
        >
          <div class="observatory-atlas-heading">
            <h2>Seven constellations</h2>
            <button type="button" onClick={closeAtlas}>
              Close
            </button>
          </div>
          <p>Two worlds taking shape. Five directions still to explore.</p>
          <For each={studies}>
            {(entry) => (
              <button
                type="button"
                class="observatory-atlas-world"
                onClick={() => {
                  selectWorld(entry.id as WorldId)
                }}
              >
                <strong>{entry.name}</strong>
                <span>
                  {entry.tonic} {entry.mode}
                </span>
                <span>Open world study</span>
              </button>
            )}
          </For>
          <For each={previews}>
            {(entry) => (
              <div class="observatory-atlas-proposal">
                <div>
                  <strong>{entry.name}</strong>
                  <span>Proposed</span>
                </div>
                <span>
                  {entry.tonic} {entry.mode}
                </span>
                <p>{entry.summary}</p>
              </div>
            )}
          </For>
        </aside>
      </Show>

      <Show when={exercise()}>
        <div class="observatory-trace-labels" aria-hidden="true">
          <For each={state()?.traceAnchors ?? []}>
            {(anchor, index) => (
              <span
                class="observatory-note-label"
                classList={{
                  'is-active':
                    stage() === 'listening' && sound()?.activeNote === index(),
                  'is-earned': index() < encounter().accepted,
                }}
                hidden={!anchor.visible}
                style={{
                  left: `${anchor.x * 100}%`,
                  top: `${anchor.y * 100}%`,
                }}
              >
                {BRIDGE_NOTE_NAMES[index()]}
              </span>
            )}
          </For>
          <Show when={keyboard() && cursorProjection()?.visible}>
            <span
              class="observatory-keyboard-cursor"
              classList={{ 'is-drawing': encounter().drawing }}
              style={{
                left: `${(cursorProjection()?.x ?? 0) * 100}%`,
                top: `${(cursorProjection()?.y ?? 0) * 100}%`,
              }}
            />
          </Show>
        </div>
      </Show>

      <div class="observatory-bottom">
        <section
          class="observatory-world-copy"
          aria-labelledby="observatory-title"
        >
          <p class="observatory-place">Irchiinnuss</p>
          <h1 id="observatory-title">
            {exercise()
              ? stage() === 'complete'
                ? 'Crossing grown'
                : 'Grow a crossing'
              : world().name}
          </h1>
          <Show
            when={!exercise()}
            fallback={
              <>
                <p class="observatory-exercise-help" role="status">
                  {stage() === 'listen'
                    ? 'Play the four notes, then trace their shape.'
                    : stage() === 'listening'
                      ? 'Listen: D, F, B, A. Then follow their shape.'
                      : traceHint(encounter())}
                </p>
                <p class="observatory-guidance">
                  {stage() === 'complete'
                    ? 'Collected for this visit. Return whenever you want to play again.'
                    : 'Guided tracing. No pitch or rhythm score.'}
                </p>
              </>
            }
          >
            <p>
              {world().tonic} {world().mode}{' '}
              <span class="observatory-copy-divider" />{' '}
              {worldId() === 'glasswake'
                ? 'Six petals, a crystal crown and a glass motif.'
                : 'Five curling fronds and a Dorian motif.'}
            </p>
            <p class="observatory-guidance">
              {worldId() === 'glasswake'
                ? 'World study. Its shattering encounter is still to come.'
                : collected()
                  ? 'Melody crossing collected for this visit.'
                  : 'Follow four notes to grow a crossing.'}
            </p>
          </Show>
        </section>

        <Show
          when={!exercise()}
          fallback={
            <section
              class="observatory-exercise-actions"
              aria-label="Melody crossing controls"
            >
              <span class="observatory-bridge-progress">
                {encounter().accepted} / 4 notes
              </span>
              <div>
                <button
                  type="button"
                  class="observatory-action"
                  disabled={!ready()}
                  onClick={() => {
                    if (
                      sound()?.playing ||
                      (sound()?.loading && sound()?.motifId)
                    ) {
                      audio?.stop()
                      setStage('listen')
                      presentTrace()
                    } else playPhrase()
                  }}
                >
                  {sound()?.playing || (sound()?.loading && sound()?.motifId)
                    ? 'Stop phrase'
                    : 'Replay phrase'}
                </button>
                <Show when={stage() === 'answer'}>
                  <button type="button" onClick={useKeyboard}>
                    Use keyboard
                  </button>
                </Show>
                <Show when={stage() === 'listen'}>
                  <button
                    type="button"
                    onClick={() => {
                      audio?.stop()
                      setTraceSound(false)
                      setStage('answer')
                      presentTrace()
                    }}
                  >
                    Trace without sound
                  </button>
                </Show>
                <Show when={encounter().accepted > 0}>
                  <button
                    type="button"
                    onClick={() => {
                      audio?.stop()
                      stopKeyboard()
                      setEncounter(createEncounter())
                      setStage('answer')
                      setCursor(BRIDGE_TARGET[0])
                      presentTrace()
                    }}
                  >
                    Start again
                  </button>
                </Show>
                <button type="button" onClick={leaveCrossing}>
                  Return to worlds
                </button>
              </div>
              <p id="observatory-trace-help">
                {keyboard()
                  ? 'Enter holds or lifts. Arrows move and change pitch. Esc returns.'
                  : traceSound()
                    ? 'Height changes pitch. Release to pause. Esc returns.'
                    : 'Press and drag through each note. Lift to pause. Esc returns.'}
              </p>
            </section>
          }
        >
          <section
            class="observatory-world-actions"
            aria-label="World controls"
          >
            <div
              class="observatory-world-switch"
              role="group"
              aria-label="Choose a world"
            >
              <For each={studies}>
                {(entry) => (
                  <button
                    type="button"
                    aria-pressed={worldId() === entry.id}
                    onClick={() => {
                      selectWorld(entry.id as WorldId)
                    }}
                  >
                    {entry.name}
                  </button>
                )}
              </For>
            </div>
            <div class="observatory-primary-actions">
              <button
                type="button"
                class="observatory-action"
                disabled={!ready()}
                onClick={() => {
                  if (sound()?.playing || sound()?.loading) audio?.stop()
                  else if (world().motif) void audio?.play(world().motif!)
                }}
              >
                {sound()?.playing || sound()?.loading
                  ? 'Stop motif'
                  : 'Hear this world'}
              </button>
              <button
                type="button"
                disabled={!ready()}
                onClick={() => {
                  const next = view() === 'inspect' ? 'overview' : 'inspect'
                  setView(next)
                  runtime?.setView(next)
                }}
              >
                {view() === 'inspect' ? 'Widen view' : 'Inspect orb'}
              </button>
              <Show when={worldId() === 'tideweave'}>
                <button
                  type="button"
                  class="observatory-action"
                  disabled={!ready()}
                  onClick={openCrossing}
                >
                  Trace a melody
                </button>
              </Show>
            </div>
          </section>
        </Show>

        <footer class="observatory-footer">
          <span>Desktop study. Headset testing is still ahead.</span>
          <div class="observatory-sound-controls">
            <label>
              Volume{' '}
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={sound()?.volume ?? 0.55}
                onInput={(event) =>
                  audio?.setVolume(event.currentTarget.valueAsNumber)
                }
              />
            </label>
            <Show when={exercise()}>
              <button
                type="button"
                aria-pressed={!traceSound()}
                onClick={() => {
                  audio?.stopTrace()
                  setTraceSound(!traceSound())
                }}
              >
                {traceSound() ? 'Mute trace' : 'Trace sound'}
              </button>
            </Show>
            <button
              type="button"
              aria-pressed={!motion()}
              onClick={() => {
                const next = !motion()
                setMotion(next)
                runtime?.setMotion(next)
              }}
            >
              {motion() ? 'Pause motion' : 'Resume motion'}
            </button>
            <Show when={!exercise()}>
              <button type="button" onClick={() => runtime?.resetCamera()}>
                Reset view
              </button>
            </Show>
          </div>
        </footer>
        <Show when={sound()?.error}>
          <p class="observatory-audio-error" role="alert">
            {sound()?.error}
          </p>
        </Show>
      </div>
    </main>
  )
}

declare global {
  interface Window {
    __observatory?: {
      runtime: ObservatoryRuntime
      audio: MotifAudio
      readonly encounter: ReturnType<typeof createEncounter>
      readonly exerciseStage: ExerciseStage
    }
  }
}
