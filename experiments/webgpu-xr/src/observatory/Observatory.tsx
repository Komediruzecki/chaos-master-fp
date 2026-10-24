// Full-screen desktop observatory joins two live worlds to one forgiving spatial melody exercise.
import '../theme/lumen.css'
import './observatory.css'
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack, } from 'solid-js'
import { earnedBookAwards } from '../almanac/bookAwards'
import { ALMANAC_WORLDS } from '../almanac/catalog'
import { MotifAudio } from '../almanac/motifAudio'
import { JourneyAlmanac, JourneyIntro, JourneyReceipt, JourneySaveStatus, } from '../journey/JourneyPanels'
import { getEarnedPages, isJourneyWorldId } from '../journey/progress'
import { TempleEnding } from '../journey/TempleEnding'
import { useJourney } from '../journey/useJourney'
import { useTempleEnding } from '../journey/useTempleEnding'
import { Icon, LogoMark } from '../theme/Icon'
import { BRIDGE_PHRASES, FIRST_BRIDGE_PHRASE } from './bridgePhrases'
import { bridgeResolutionFor } from './bridgeScore'
import { beginTrace, createEncounter, endTrace, moveTrace, traceHint, } from './encounter'
import { GlasswakeEncounter } from './GlasswakeEncounter'
import { PassageThreshold } from './PassageThreshold'
import { ObservatoryRuntime } from './runtime'
import { pitchForTraceHeight } from './traceAudio'
import type { BridgePhrase } from './bridgePhrases'
import type { EncounterState, TracePoint } from './encounter'
import type { ObservatoryInput, ObservatorySnapshot, ObservatoryView, WorldId, } from './scene'

type ExerciseStage = 'listen' | 'listening' | 'answer' | 'complete'
const studies = ALMANAC_WORLDS.filter((world) => world.status === 'study')
const previews = ALMANAC_WORLDS.filter((world) => world.status === 'preview')

export function Observatory() {
  const journey = useJourney()
  const requestedWorld = new URLSearchParams(window.location.search).get(
    'world',
  )
  const initialWorld = isJourneyWorldId(requestedWorld)
    ? requestedWorld
    : journey.snapshot().progress.lastSelectedWorld
  let canvas!: HTMLCanvasElement
  let atlasToggle!: HTMLButtonElement
  let atlasDialog: HTMLDialogElement | undefined
  let runtime: ObservatoryRuntime | undefined
  let audio: MotifAudio | undefined
  const heldKeys = new Set<string>()
  let keyboardFrame = 0
  let keyboardTime = 0
  const [state, setState] = createSignal<ObservatorySnapshot>()
  const [sound, setSound] = createSignal<ReturnType<MotifAudio['snapshot']>>()
  const [worldId, setWorldId] = createSignal<WorldId>(initialWorld)
  const [view, setView] = createSignal<ObservatoryView>('overview')
  const [atlasOpen, setAtlasOpen] = createSignal(false)
  const [glasswake, setGlasswake] = createSignal(false)
  const glassCollected = createMemo(() =>
    Boolean(journey.snapshot().progress.worlds.glasswake.completion),
  )
  const [glassProgress, setGlassProgress] = createSignal(0)
  const [exercise, setExercise] = createSignal(false)
  const [stage, setStage] = createSignal<ExerciseStage>('listen')
  const [phrase, setPhrase] = createSignal(FIRST_BRIDGE_PHRASE)
  const [encounter, setEncounter] = createSignal(createEncounter())
  const [motion, setMotion] = createSignal(true)
  const [keyboard, setKeyboard] = createSignal(false)
  const [cursor, setCursor] = createSignal<TracePoint>(phrase().target[0])
  const collected = createMemo(() =>
    Boolean(journey.snapshot().progress.worlds.tideweave.completion),
  )
  const [traceSound, setTraceSound] = createSignal(true)
  const [panel, setPanel] = createSignal<
    'intro' | 'almanac' | 'receipt' | null
  >(null)
  const [receiptWorld, setReceiptWorld] = createSignal<WorldId>('glasswake')
  const earnedPages = createMemo(
    () => getEarnedPages(journey.snapshot().progress).length,
  )
  const world = createMemo(
    () => studies.find((entry) => entry.id === worldId())!,
  )
  const passing = createMemo(() => Boolean(state()?.passage.active))
  const ready = createMemo(() => Boolean(state()?.ready) && !passing())
  const ending = useTempleEnding({
    eligible: () => earnedPages() === 2,
    ready,
    audio: () => audio,
    present: (value) => runtime?.setTemple(value),
    enter: () => {
      closePanel()
      interruptInput()
      setExercise(false)
      setGlasswake(false)
      setAtlasOpen(false)
      goToView('temple')
      presentTrace()
    },
    leave: () => {
      goToView('overview')
      queueMicrotask(() => {
        canvas.focus({ preventScroll: true })
      })
    },
  })
  const glassBlocked = createMemo(
    () => atlasOpen() || panel() !== null || !ready(),
  )
  const playingWorldId = createMemo(
    () =>
      studies.find(
        (entry) =>
          sound()?.playing &&
          sound()?.motifId ===
            (journey.snapshot().progress.worlds[entry.id as WorldId].completion
              ?.motif.id ?? entry.motif?.id),
      )?.id as WorldId | undefined,
  )
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
      target: phrase().target,
      response: encounter().response,
      acceptedSegments: encounter().accepted,
      segmentCount: phrase().target.length,
    })
  }

  function updateSound() {
    if (!audio) return
    const next = audio.snapshot()
    setSound(next)
    ending.update(next)
    if (exercise()) {
      if (next.playing && next.motifId === phrase().motif.id)
        setStage('listening')
      else if (!next.playing && next.progress === 1)
        setStage(
          encounter().accepted === phrase().target.length
            ? 'complete'
            : 'answer',
        )
      else if (!next.playing && !next.loading && stage() === 'listening')
        setStage('listen')
      presentTrace()
    }
  }

  function selectWorld(id: WorldId) {
    ending.close()
    stopKeyboard()
    setExercise(false)
    setGlasswake(false)
    audio?.stopInstrument()
    setWorldId(id)
    setAtlasOpen(false)
    journey.store.discoverWorld(id)
    const url = new URL(window.location.href)
    url.searchParams.set('world', id)
    window.history.replaceState(null, '', url)
    goToView('overview', id)
    presentTrace()
  }

  function goToView(next: ObservatoryView, id = worldId()) {
    const previous = runtime?.snapshot()
    const changed = previous?.view !== next || previous?.selectedWorld !== id
    setView(next)
    runtime?.navigate(next, id)
    if (next === 'temple') audio?.stopAmbience()
    else audio?.changeAmbience(id, changed)
    // Disabling the departing button can move focus to body. Keep Escape available.
    canvas.focus({ preventScroll: true })
  }

  function leaveCrossing() {
    stopKeyboard()
    setExercise(false)
    setGlasswake(false)
    audio?.stopInstrument()
    setEncounter(endTrace(encounter(), undefined, phrase()))
    goToView('overview')
    presentTrace()
    canvas.focus({ preventScroll: true })
  }

  function playPhrase(leadInSeconds = 0) {
    stopKeyboard()
    setEncounter(endTrace(encounter(), undefined, phrase()))
    setStage('listen')
    void audio?.play(phrase().motif, leadInSeconds)
    presentTrace()
  }

  function openGlasswake() {
    audio?.stopInstrument()
    stopKeyboard()
    setExercise(false)
    setAtlasOpen(false)
    journey.store.discoverWorld('glasswake')
    if (glassCollected()) setGlassProgress(0)
    setGlasswake(true)
    goToView('glasswake')
    presentTrace()
  }

  function openCrossing() {
    audio?.stopInstrument()
    setPhrase(FIRST_BRIDGE_PHRASE)
    setCursor(FIRST_BRIDGE_PHRASE.target[0])
    journey.store.discoverWorld('tideweave')
    if (collected()) setEncounter(createEncounter())
    setAtlasOpen(false)
    setExercise(true)
    setKeyboard(false)
    goToView('trace')
    // Unlock audio in this gesture, but let the first teaching note wait for arrival.
    playPhrase((runtime?.snapshot().passage.remainingMs ?? 0) / 1000)
  }

  function choosePhrase(next: BridgePhrase) {
    if (!collected() || !exercise() || !ready() || document.hidden) return
    stopKeyboard()
    runtime?.cancelInput()
    audio?.stopInstrument()
    setPhrase(next)
    setEncounter(createEncounter())
    setCursor(next.target[0])
    setKeyboard(false)
    setStage('listen')
    presentTrace()
  }

  function acceptInput(event: ObservatoryInput) {
    if (
      event.kind === 'trace' &&
      (event.phase === 'cancel' ||
        (event.phase === 'end' && stage() !== 'complete'))
    )
      audio?.stopTrace()
    if (document.hidden || atlasOpen() || panel() !== null || !ready()) return
    if (event.kind === 'world') {
      selectWorld(event.worldId)
      return
    }
    if (!exercise() || stage() !== 'answer') return
    stopKeyboard()
    setKeyboard(false)
    const before = encounter()
    if (event.phase === 'end' || event.phase === 'cancel')
      setEncounter(endTrace(encounter(), undefined, phrase()))
    else if (event.point) {
      setEncounter(
        event.phase === 'start'
          ? beginTrace(encounter(), event.point, phrase())
          : moveTrace(encounter(), event.point, phrase()),
      )
    } else setEncounter(endTrace(encounter(), 'outside', phrase()))
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
      next.accepted === phrase().target.length &&
      next.accepted > before.accepted
    ) {
      audio?.finishTrace(
        phrase().motif.notes.at(-1)!.midi,
        bridgeResolutionFor(phrase()),
      )
      return
    }
    const midi = point ? pitchForTraceHeight(point[1], phrase()) : null
    if (!next.drawing || midi === null) {
      audio?.stopTrace()
      return
    }
    const earnedMidi =
      next.accepted > before.accepted
        ? phrase().motif.notes[next.accepted - 1].midi
        : undefined
    if (start) void audio?.startTrace(midi, earnedMidi)
    else audio?.updateTrace(midi, earnedMidi)
  }

  function finishInput() {
    if (encounter().accepted === phrase().target.length) {
      setStage('complete')
      if (!collected()) journey.store.completeWorld('tideweave')
    }
    presentTrace()
  }

  function useKeyboard() {
    if (!ready() || document.hidden) return
    stopKeyboard()
    audio?.stopTrace()
    setKeyboard(true)
    setEncounter(endTrace(encounter(), undefined, phrase()))
    setCursor(phrase().target[Math.max(0, encounter().accepted - 1)])
    canvas.focus({ preventScroll: true })
    presentTrace()
  }

  function stopKeyboard() {
    heldKeys.clear()
    cancelAnimationFrame(keyboardFrame)
    keyboardFrame = 0
  }

  function releaseInput() {
    stopKeyboard()
    audio?.stopTrace()
    setEncounter(endTrace(encounter(), undefined, phrase()))
    runtime?.cancelInput()
    presentTrace()
  }

  function interruptInput() {
    audio?.stop()
    releaseInput()
    // Window/modal interruption settles travel; moving focus within the scene does not.
    runtime?.setActive(false)
    if (!document.hidden) runtime?.setActive(true)
  }

  function closeAtlas() {
    atlasDialog?.close()
    setAtlasOpen(false)
    queueMicrotask(() => {
      atlasToggle.focus({ preventScroll: true })
    })
  }

  function openPanel(next: 'intro' | 'almanac' | 'receipt', id = worldId()) {
    ending.close()
    interruptInput()
    audio?.stop()
    setAtlasOpen(false)
    setReceiptWorld(id)
    setPanel(next)
  }

  function closePanel() {
    audio?.stop()
    if (panel() === 'intro') journey.store.completeOnboarding()
    setPanel(null)
  }

  function visitWorld(id: WorldId) {
    closePanel()
    selectWorld(id)
    queueMicrotask(() => {
      canvas.focus({ preventScroll: true })
    })
  }

  function playPageMotif(id: WorldId) {
    const motif =
      journey.snapshot().progress.worlds[id].completion?.motif ??
      studies.find((entry) => entry.id === id)?.motif
    if (!motif) return
    if ((sound()?.playing || sound()?.loading) && sound()?.motifId === motif.id)
      audio?.stopInstrument()
    else void audio?.play(motif)
  }

  function practiceNote(midi: number | null) {
    if (midi === null) audio?.stopTrace()
    else if (!ready()) return
    else if (sound()?.trace.active || sound()?.trace.pending)
      audio?.updateTrace(midi)
    else void audio?.startTrace(midi)
  }

  function hearIntroductionNote() {
    if (!ready()) return
    void audio?.play({
      id: 'journey-first-note',
      tonic: 'C',
      mode: 'Ionian',
      tempo: 90,
      timbre: 'glass',
      notes: [{ midi: 60, beat: 0, duration: 1.3 }],
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
      panel() !== null ||
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
    if (encounter().drawing)
      setEncounter(moveTrace(encounter(), next, phrase()))
    syncTraceSound(before, next)
    finishInput()
    keyboardFrame = requestAnimationFrame(moveKeyboard)
  }

  function keyDown(event: KeyboardEvent) {
    if (panel() !== null) return
    if (event.key === 'Escape') {
      if (ending.active()) {
        event.preventDefault()
        event.stopPropagation()
        ending.close()
        return
      }
      if (atlasOpen() || exercise() || glasswake() || view() === 'inspect') {
        event.preventDefault()
        event.stopPropagation()
      }
      if (atlasOpen()) closeAtlas()
      else if (exercise()) leaveCrossing()
      else if (glasswake()) {
        setGlasswake(false)
        audio?.stopInstrument()
        goToView('overview')
        canvas.focus({ preventScroll: true })
      } else if (view() === 'inspect') {
        goToView('overview')
      }
      return
    }
    if (glasswake()) return
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
            ? endTrace(encounter(), undefined, phrase())
            : beginTrace(encounter(), cursor(), phrase()),
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

  createEffect(() => {
    const awards = earnedBookAwards(journey.snapshot().progress)
    untrack(() => runtime?.setBookAwards(awards))
  })

  onMount(() => {
    audio = new MotifAudio(updateSound)
    runtime = new ObservatoryRuntime(canvas, {
      changed: () => {
        if (runtime) {
          const next = runtime.snapshot()
          setState(next)
          if (next.error) {
            stopKeyboard()
            ending.stop()
            audio?.stop()
            setEncounter(endTrace(encounter(), undefined, phrase()))
          }
        }
      },
      input: acceptInput,
      music: () => {
        const snapshot = audio?.snapshot()
        return snapshot
          ? {
              ...snapshot,
              playing:
                snapshot.playing ||
                snapshot.trace.active ||
                snapshot.effect.active,
            }
          : {
              playing: false,
              level: 0,
              activeNote: null,
              progress: 0,
            }
      },
    })
    runtime.setBookAwards(earnedBookAwards(journey.snapshot().progress))
    runtime.selectWorld(initialWorld)
    if (!journey.snapshot().progress.onboardingCompleted) setPanel('intro')
    else journey.store.selectWorld(initialWorld)
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
    canvas.addEventListener('blur', releaseInput)
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
        get phrase() {
          return phrase()
        },
        get cursor() {
          return cursor()
        },
        get exerciseStage() {
          return stage()
        },
        get journey() {
          return journey.snapshot()
        },
      }
    onCleanup(() => {
      preference.removeEventListener('change', reduceMotion)
      window.removeEventListener('keyup', releaseKey)
      window.removeEventListener('blur', interruptInput)
      document.removeEventListener('visibilitychange', visibility)
      canvas.removeEventListener('blur', releaseInput)
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
      classList={{
        'is-exercise': exercise() || glasswake(),
        'is-temple': ending.active(),
      }}
      data-world={worldId()}
      data-passage={state()?.passage.phase ?? 'idle'}
      style={{
        '--passage-content': passing()
          ? state()?.passage.phase === 'arriving'
            ? 1 - (state()?.passage.opacity ?? 0)
            : 0
          : 1,
      }}
      onKeyDown={keyDown}
    >
      <canvas
        ref={canvas}
        class="observatory-canvas"
        tabIndex={0}
        aria-busy={passing()}
        aria-describedby={exercise() ? 'observatory-trace-help' : undefined}
        aria-label={
          ending.active()
            ? 'Irchiinnuss temple threshold. Listen to the two worlds with the controls below.'
            : exercise()
              ? 'Tideweave melody ribbon. Use keyboard controls below, or drag through the notes.'
              : 'Irchiinnuss observatory. Drag to turn the view and scroll to move closer.'
        }
      />
      <div class="observatory-shade" aria-hidden="true" />
      <PassageThreshold passage={state()?.passage} />
      <header class="observatory-header">
        <a
          class="observatory-brand"
          href="/almanac"
          aria-label="Lumen Apeiron Almanac"
        >
          <LogoMark />
          <span>Lumen Apeiron</span>
        </a>
        <span class="observatory-location">Irchiinnuss</span>
        <nav aria-label="Observatory navigation">
          <button
            type="button"
            class="observatory-ambience"
            aria-label={
              sound()?.ambience.enabled ? 'Mute ambience' : 'Enable ambience'
            }
            aria-pressed={sound()?.ambience.enabled ?? false}
            disabled={
              !state()?.ready ||
              Boolean(state()?.error) ||
              ending.active() ||
              panel() !== null ||
              atlasOpen()
            }
            title={
              sound()?.ambience.enabled
                ? 'Mute ambient sound and travel cues'
                : `Hear ${worldId() === 'glasswake' ? 'the Glasswake glass chamber' : 'the Tideweave reed current'}. Stops when you leave the window.`
            }
            onClick={() => {
              void audio?.setAmbience(worldId(), !sound()?.ambience.enabled)
            }}
          >
            <Icon name="music" />
            <span class="observatory-nav-label">Ambience</span>
          </button>
          <button
            ref={atlasToggle}
            type="button"
            aria-expanded={atlasOpen()}
            aria-controls="observatory-atlas"
            aria-label="Seven constellations"
            onClick={() => {
              ending.close()
              interruptInput()
              if (atlasOpen()) closeAtlas()
              else setAtlasOpen(true)
            }}
          >
            <Icon name="globe" />
            <span class="observatory-nav-label">Atlas</span>
          </button>
          <button
            type="button"
            onClick={() => {
              openPanel('intro')
            }}
            aria-label="Guide"
          >
            <Icon name="guide" />
            <span class="observatory-nav-label">Guide</span>
          </button>
          <button
            type="button"
            onClick={() => {
              openPanel('almanac')
            }}
            aria-label={`Almanac, ${earnedPages()} of 2 pages earned`}
          >
            <Icon name="book" />
            <span class="observatory-nav-label">Almanac</span>
            <span class="observatory-page-count" aria-hidden="true">
              <i
                data-world="glasswake"
                classList={{ 'is-earned': glassCollected() }}
              />
              <i
                data-world="tideweave"
                classList={{ 'is-earned': collected() }}
              />
            </span>
          </button>
        </nav>
      </header>

      <Show when={!state()?.ready && !state()?.error}>
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
          ready() &&
          (state()?.assets.some((asset) => asset.status === 'error') ||
            state()?.bookDetail.status === 'error' ||
            state()?.sceneDetail.status === 'error')
        }
      >
        <div class="observatory-asset-error" role="alert">
          Some objects or surface details could not load.{' '}
          <button type="button" onClick={() => runtime?.retryAssets()}>
            Retry objects
          </button>
        </div>
      </Show>

      <Show when={atlasOpen()}>
        <dialog
          ref={(element) => {
            atlasDialog = element
            queueMicrotask(() => {
              if (element.isConnected && !element.open) element.showModal()
            })
          }}
          onCancel={(event) => {
            event.preventDefault()
            closeAtlas()
          }}
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
          <p class="lx-label">Playable worlds</p>
          <For each={studies}>
            {(entry) => (
              <button
                type="button"
                class="observatory-atlas-world"
                data-world={entry.id}
                onClick={() => {
                  atlasDialog?.close()
                  selectWorld(entry.id as WorldId)
                  queueMicrotask(() => {
                    canvas.focus({ preventScroll: true })
                  })
                }}
              >
                <Icon name={entry.id === 'glasswake' ? 'star' : 'music'} />
                <strong>{entry.name}</strong>
                <span class="observatory-atlas-mode">
                  {entry.tonic} {entry.mode}
                </span>
                <span class="observatory-atlas-status">
                  {journey.snapshot().progress.worlds[entry.id as WorldId]
                    .completion
                    ? 'Page earned'
                    : 'Not yet earned'}
                </span>
                <span class="observatory-atlas-visit">
                  Visit <Icon name="right" />
                </span>
              </button>
            )}
          </For>
          <p class="observatory-atlas-preview-label">
            Previews · not playable in this build
          </p>
          <For each={previews}>
            {(entry) => (
              <div class="observatory-atlas-proposal">
                <div>
                  <strong>{entry.name}</strong>
                  <span>Preview</span>
                </div>
                <span>
                  {entry.tonic} {entry.mode}
                </span>
              </div>
            )}
          </For>
        </dialog>
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
                {phrase().noteNames[index()]}
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

      <Show when={glasswake() && runtime && audio}>
        <GlasswakeEncounter
          initialAccepted={glassProgress()}
          onProgress={setGlassProgress}
          runtime={runtime!}
          audio={audio!}
          sound={sound()}
          persistence={journey.snapshot().persistence}
          blocked={glassBlocked()}
          motion={motion()}
          onMotion={() => {
            const next = !motion()
            setMotion(next)
            runtime?.setMotion(next)
          }}
          onLeave={() => {
            setGlasswake(false)
            audio?.stopInstrument()
            goToView('overview')
            canvas.focus({ preventScroll: true })
          }}
          onCollected={() => journey.store.completeWorld('glasswake')}
          onOpenPage={() => {
            openPanel('receipt', 'glasswake')
          }}
        />
      </Show>
      <Show when={!glasswake() && !ending.active()}>
        <div class="observatory-bottom">
          <Show when={!exercise()}>
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
                    data-world={entry.id}
                    onClick={() => {
                      selectWorld(entry.id as WorldId)
                    }}
                  >
                    <Icon name={entry.id === 'glasswake' ? 'star' : 'music'} />
                    {entry.name}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <section
            class="observatory-world-copy"
            aria-labelledby="observatory-title"
          >
            <p class="observatory-place">
              {exercise()
                ? `Tideweave · ${phrase().title}`
                : worldId() === 'glasswake'
                  ? 'World I'
                  : 'World II'}
            </p>
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
                        ? `Listen: ${phrase().noteNames.join(', ')}. Then follow their shape.`
                        : traceHint(encounter(), phrase())}
                  </p>
                  <p class="observatory-guidance">
                    {stage() === 'complete'
                      ? phrase().id === FIRST_BRIDGE_PHRASE.id
                        ? 'Four notes traced. Your Tideweave page is earned.'
                        : `${phrase().title} traced. Your Almanac page keeps its first melody.`
                      : 'Guided tracing. No pitch or rhythm score.'}
                  </p>
                </>
              }
            >
              <p class="observatory-world-mode">
                {world().tonic} {world().mode}
              </p>
              <p class="observatory-world-description">
                {worldId() === 'glasswake'
                  ? 'Six petals, a crystal crown and a glass motif.'
                  : 'Five curling fronds and a Dorian motif.'}
              </p>
              <p class="observatory-guidance">
                {worldId() === 'glasswake'
                  ? glassCollected()
                    ? 'First light earned. Your Glasswake page is in the Almanac.'
                    : 'Hear, hold and release three notes to open the glass.'
                  : collected()
                    ? 'Melody crossing earned. Your Tideweave page is in the Almanac.'
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
                <Show when={collected()}>
                  <div
                    class="observatory-phrases"
                    role="group"
                    aria-label="Practice phrases"
                  >
                    <For each={BRIDGE_PHRASES}>
                      {(entry) => (
                        <button
                          type="button"
                          aria-pressed={phrase().id === entry.id}
                          disabled={!ready()}
                          onClick={() => {
                            choosePhrase(entry)
                          }}
                        >
                          {entry.title}
                        </button>
                      )}
                    </For>
                  </div>
                  <p class="observatory-phrase-description">
                    {phrase().description}
                  </p>
                </Show>
                <span class="observatory-bridge-progress">
                  <span
                    class="observatory-progress-segments"
                    aria-hidden="true"
                  >
                    <For each={phrase().target}>
                      {(_, index) => (
                        <i
                          classList={{
                            'is-earned': index() < encounter().accepted,
                          }}
                        />
                      )}
                    </For>
                  </span>
                  {encounter().accepted} of 4 notes
                </span>
                <div>
                  <Show when={stage() === 'complete'}>
                    <button
                      type="button"
                      class="observatory-action lx-primary"
                      onClick={() => {
                        openPanel('receipt', 'tideweave')
                      }}
                    >
                      Open earned page
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="observatory-action"
                    classList={{
                      'lx-primary': stage() !== 'complete',
                      'lx-secondary': stage() === 'complete',
                    }}
                    disabled={!ready()}
                    onClick={() => {
                      if (
                        sound()?.playing ||
                        (sound()?.loading && sound()?.motifId)
                      ) {
                        audio?.stopInstrument()
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
                        audio?.stopInstrument()
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
                        audio?.stopInstrument()
                        stopKeyboard()
                        setEncounter(createEncounter())
                        setStage('answer')
                        setCursor(phrase().target[0])
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
              <div class="observatory-primary-actions">
                <button
                  type="button"
                  class="observatory-action"
                  classList={{
                    'lx-primary':
                      earnedPages() !== 2 &&
                      (worldId() === 'glasswake'
                        ? glassCollected()
                        : collected()),
                    'lx-secondary':
                      earnedPages() === 2 ||
                      !(worldId() === 'glasswake'
                        ? glassCollected()
                        : collected()),
                  }}
                  disabled={!ready()}
                  onClick={() => {
                    if (sound()?.playing || sound()?.loading)
                      audio?.stopInstrument()
                    else if (world().motif) void audio?.play(world().motif!)
                  }}
                >
                  {sound()?.playing || sound()?.loading
                    ? 'Stop motif'
                    : 'Hear this world'}
                </button>
                <button
                  type="button"
                  class="lx-secondary"
                  disabled={!ready()}
                  onClick={() => {
                    const next = view() === 'inspect' ? 'overview' : 'inspect'
                    goToView(next)
                  }}
                >
                  {view() === 'inspect' ? 'Widen view' : 'Inspect orb'}
                </button>
                <Show when={worldId() === 'glasswake'}>
                  <button
                    type="button"
                    class="observatory-action"
                    classList={{
                      'lx-primary': !glassCollected(),
                      'lx-tertiary': glassCollected(),
                    }}
                    disabled={!ready()}
                    onClick={openGlasswake}
                  >
                    {glassCollected() ? 'Play again' : 'Wake the glass'}
                  </button>
                </Show>
                <Show when={worldId() === 'tideweave'}>
                  <button
                    type="button"
                    class="observatory-action"
                    classList={{
                      'lx-primary': !collected(),
                      'lx-tertiary': collected(),
                    }}
                    disabled={!ready()}
                    onClick={openCrossing}
                  >
                    {collected() ? 'Play again' : 'Trace a melody'}
                  </button>
                </Show>
                <Show when={earnedPages() === 2}>
                  <button
                    type="button"
                    class="observatory-action lx-primary"
                    disabled={!ready()}
                    onClick={ending.open}
                  >
                    Open temple signal
                  </button>
                </Show>
              </div>
            </section>
          </Show>

          <footer class="observatory-footer">
            <JourneySaveStatus persistence={journey.snapshot().persistence} />
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
      </Show>
      <Show when={ending.active()}>
        <TempleEnding
          phase={ending.phase()}
          progress={ending.progress()}
          ready={ready()}
          motion={motion()}
          volume={sound()?.volume ?? 0.55}
          error={sound()?.error}
          persistence={journey.snapshot().persistence}
          onPlay={ending.play}
          onStop={ending.stop}
          onLeave={ending.close}
          onMotion={() => {
            const next = !motion()
            setMotion(next)
            runtime?.setMotion(next)
          }}
          onVolume={(value) => audio?.setVolume(value)}
        />
      </Show>
      <Show when={panel() === 'intro'}>
        <JourneyIntro
          ready={ready()}
          onClose={closePanel}
          onBegin={visitWorld}
          onHearNote={hearIntroductionNote}
          onPracticeNote={practiceNote}
          audioStatus={sound()?.error ?? undefined}
        />
      </Show>
      <Show when={panel() === 'almanac'}>
        <JourneyAlmanac
          progress={journey.snapshot().progress}
          persistence={journey.snapshot().persistence}
          onClose={closePanel}
          onVisit={visitWorld}
          onPlayMotif={playPageMotif}
          playingWorldId={playingWorldId()}
          onOpenEnding={ending.open}
        />
      </Show>
      <Show when={panel() === 'receipt'}>
        <JourneyReceipt
          worldId={receiptWorld()}
          progress={journey.snapshot().progress}
          persistence={journey.snapshot().persistence}
          onClose={closePanel}
          onVisit={visitWorld}
          onOpenAlmanac={() => {
            openPanel('almanac')
          }}
          onPlayMotif={playPageMotif}
          playingWorldId={playingWorldId()}
          onOpenEnding={ending.open}
        />
      </Show>
    </main>
  )
}

declare global {
  interface Window {
    __observatory?: {
      runtime: ObservatoryRuntime
      audio: MotifAudio
      readonly encounter: ReturnType<typeof createEncounter>
      readonly phrase: BridgePhrase
      readonly cursor: TracePoint
      readonly exerciseStage: ExerciseStage
      readonly journey: ReturnType<
        ReturnType<typeof useJourney>['store']['read']
      >
    }
  }
}
