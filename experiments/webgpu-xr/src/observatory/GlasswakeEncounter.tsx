// Desktop resonance instrument: a deliberate release opens one seal; interruption never does.
import './glasswake.css'
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, } from 'solid-js'
import { advanceGlassHold, beginGlassHold, cancelGlassHold, createGlasswakeEncounter, GLASS_NOTES, releaseGlassHold, updateGlassPitch, } from './glasswakeEncounter'
import type { MotifAudio, MotifAudioSnapshot } from '../almanac/motifAudio'
import type { ObservatoryRuntime } from './runtime'

interface Props {
  audio: MotifAudio
  runtime: ObservatoryRuntime
  sound: MotifAudioSnapshot | undefined
  blocked: boolean
  motion: boolean
  initialAccepted: number
  onProgress(accepted: number): void
  onMotion(): void
  onLeave(): void
  onCollected(): void
}

export function GlasswakeEncounter(props: Props) {
  let pad!: HTMLDivElement
  let pointer: number | null = null
  let frame = 0
  let previous = 0
  const [state, setState] = createSignal(
    createGlasswakeEncounter(props.initialAccepted),
  )
  const [clock, setClock] = createSignal(0)
  const [bursts, setBursts] = createSignal<number[]>(
    Array.from({ length: state().accepted }, () => -10),
  )
  const [muted, setMuted] = createSignal(false)
  const [coolUntil, setCoolUntil] = createSignal(0)
  const complete = createMemo(() => state().accepted === GLASS_NOTES.length)
  const target = createMemo(
    () => GLASS_NOTES[Math.min(state().accepted, GLASS_NOTES.length - 1)],
  )
  const cooling = createMemo(() => clock() < coolUntil())
  const targetHeight = createMemo(() => 8 + ((72 - target().midi) / 12) * 84)
  const pitchHeight = createMemo(() => 8 + ((72 - state().pitch) / 12) * 84)
  const hint = createMemo(() => {
    if (complete())
      return 'Three seals opened. The first light is yours for this visit.'
    if (cooling()) return 'Let the glass fall. The next seal is waiting.'
    if (state().armed) return 'Ready. Release to shatter the seal.'
    if (state().holding)
      return Math.abs(state().pitch - target().midi) <= 0.4
        ? 'Keep the note here. The crystal is resonating.'
        : state().pitch < target().midi
          ? 'Move upward to raise the note.'
          : 'Move downward to lower the note.'
    if (state().feedback === 'early')
      return 'A little longer next time. Your opened seals are still here.'
    return `Hear ${target().name}, then hold its line until the crystal is ready.`
  })

  function present() {
    props.runtime.setGlasswake({
      time: clock(),
      accepted: state().accepted,
      charge: state().charge,
      holding: state().holding,
      burstTimes: bursts(),
    })
  }

  function releasePointer() {
    const id = pointer
    pointer = null
    if (id !== null && pad?.hasPointerCapture(id)) pad.releasePointerCapture(id)
  }

  function cancel() {
    releasePointer()
    setState(cancelGlassHold(state()))
    props.audio.stop()
    previous = 0
    present()
  }

  function begin(midi: number) {
    if (
      props.blocked ||
      document.hidden ||
      complete() ||
      cooling() ||
      state().holding
    )
      return false
    props.audio.stop()
    setState(beginGlassHold(state(), midi))
    previous = 0
    if (!muted()) void props.audio.startTrace(state().pitch)
    present()
    return true
  }

  function tune(midi: number) {
    setState(updateGlassPitch(state(), midi))
    if (state().holding && !muted()) props.audio.updateTrace(state().pitch)
    present()
  }

  function release() {
    const before = state().accepted
    const note = target().midi
    releasePointer()
    setState(releaseGlassHold(state()))
    props.audio.stop()
    if (state().accepted > before) {
      setBursts((times) => {
        const next = [...times]
        next[before] = props.motion ? clock() : clock() - 10
        return next
      })
      props.onProgress(state().accepted)
      setCoolUntil(clock() + 1.5)
      if (!muted()) void props.audio.shatter(note)
      if (complete()) props.onCollected()
    }
    present()
  }

  function pointerPitch(event: PointerEvent) {
    const rect = pad.getBoundingClientRect()
    return Math.max(
      60,
      Math.min(
        72,
        72 - (((event.clientY - rect.top) / rect.height - 0.08) / 0.84) * 12,
      ),
    )
  }

  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancel()
      props.onLeave()
      return
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key))
      return
    event.preventDefault()
    event.stopPropagation()
    if (props.blocked || document.hidden || cooling() || complete()) return
    if (event.key === 'Enter') {
      if (!event.repeat) {
        if (state().holding) release()
        else begin(state().pitch)
      }
    } else if (pointer === null) {
      tune(
        Math.max(
          60,
          Math.min(
            72,
            event.key === 'Home'
              ? 60
              : event.key === 'End'
                ? 72
                : state().pitch + (event.key === 'ArrowUp' ? 0.25 : -0.25),
          ),
        ),
      )
    }
  }

  function hearNote() {
    cancel()
    if (props.blocked || complete()) return
    void props.audio.play({
      id: `glasswake-reference-${target().midi}`,
      tonic: 'C',
      mode: 'Ionian',
      tempo: 90,
      timbre: 'glass',
      notes: [{ midi: target().midi, beat: 0, duration: 1.3 }],
    })
  }

  function rebuild() {
    cancel()
    setState(createGlasswakeEncounter())
    props.onProgress(0)
    setBursts([])
    setCoolUntil(0)
    present()
    pad.focus({ preventScroll: true })
  }

  createEffect(
    on(
      () => props.blocked,
      (blocked) => {
        if (blocked) cancel()
      },
    ),
  )
  createEffect(
    on(
      () => props.motion,
      (motion) => {
        if (!motion) {
          setBursts((values) => values.map(() => -10))
          present()
        }
      },
    ),
  )

  onMount(() => {
    const tick = (now: number) => {
      if (!document.hidden && !props.blocked) {
        const elapsed = previous ? Math.max(0, (now - previous) / 1000) : 0
        const delta = Math.min(0.05, elapsed)
        previous = now
        setClock((value) => value + delta)
        if (state().holding) setState(advanceGlassHold(state(), elapsed))
        present()
      } else previous = 0
      frame = requestAnimationFrame(tick)
    }
    const visibility = () => {
      if (document.hidden) cancel()
    }
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', visibility)
    frame = requestAnimationFrame(tick)
    present()
    if (import.meta.env.DEV)
      window.__glasswake = {
        get state() {
          return state()
        },
        get time() {
          return clock()
        },
        get burstTimes() {
          return [...bursts()]
        },
        get cooling() {
          return cooling()
        },
      }
    onCleanup(() => {
      cancelAnimationFrame(frame)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', visibility)
      cancel()
      if (import.meta.env.DEV) delete window.__glasswake
    })
  })

  return (
    <>
      <div
        ref={pad}
        class="glasswake-instrument"
        data-testid="glasswake-instrument"
        classList={{
          'is-holding': state().holding,
          'is-armed': state().armed,
          'is-complete': complete(),
        }}
        role="slider"
        tabIndex={0}
        aria-label="Crystal pitch instrument"
        aria-orientation="vertical"
        aria-valuemin={60}
        aria-valuemax={72}
        aria-valuenow={state().pitch}
        aria-valuetext={`MIDI ${state().pitch.toFixed(2)}. Target ${target().name}.`}
        aria-describedby="glasswake-help"
        aria-disabled={props.blocked || cooling() || complete()}
        onKeyDown={keyDown}
        onBlur={() => {
          if (state().holding) cancel()
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || pointer !== null) return
          event.preventDefault()
          pad.focus({ preventScroll: true })
          if (begin(pointerPitch(event))) {
            pointer = event.pointerId
            pad.setPointerCapture(pointer)
          }
        }}
        onPointerMove={(event) => {
          if (event.pointerId === pointer) tune(pointerPitch(event))
        }}
        onPointerUp={(event) => {
          if (event.pointerId === pointer) {
            tune(pointerPitch(event))
            release()
          }
        }}
        onPointerCancel={(event) => {
          if (event.pointerId === pointer) cancel()
        }}
        onLostPointerCapture={(event) => {
          if (event.pointerId === pointer) cancel()
        }}
      >
        <Show when={!complete()}>
          <span class="glasswake-range-top" aria-hidden="true">
            C5
          </span>
          <span class="glasswake-range-bottom" aria-hidden="true">
            C4
          </span>
          <span
            class="glasswake-target"
            style={{ top: `${targetHeight()}%` }}
            aria-hidden="true"
          >
            <span>{target().name}</span>
          </span>
          <span
            class="glasswake-pitch"
            style={{ top: `${pitchHeight()}%` }}
            aria-hidden="true"
          />
        </Show>
        <div class="glasswake-resonance" aria-hidden="true">
          <span>
            {complete()
              ? 'First light'
              : state().armed
                ? 'Release'
                : state().holding
                  ? `${Math.round(state().charge * 100)}%`
                  : 'Touch the glass'}
          </span>
          <span class="glasswake-charge">
            <i style={{ transform: `scaleX(${state().charge})` }} />
          </span>
        </div>
      </div>
      <div class="observatory-bottom glasswake-bottom">
        <section
          class="observatory-world-copy"
          aria-labelledby="glasswake-title"
        >
          <p class="observatory-place">Glasswake · C Ionian</p>
          <h1 id="glasswake-title">
            {complete() ? 'First light, released' : 'Wake the glass'}
          </h1>
          <p role="status">{hint()}</p>
          <p class="observatory-guidance">
            {complete()
              ? 'Aureole collected for this visit.'
              : 'A guided pitch instrument. No microphone or singing score.'}
          </p>
        </section>
        <section
          class="observatory-exercise-actions"
          aria-label="Glasswake controls"
        >
          <div
            class="glasswake-seals"
            aria-label={`${state().accepted} of 3 seals opened`}
          >
            <For each={GLASS_NOTES}>
              {(note, index) => (
                <span
                  classList={{
                    'is-open': index() < state().accepted,
                    'is-next': index() === state().accepted,
                  }}
                >
                  {note.name}
                  <small>
                    {index() < state().accepted
                      ? 'open'
                      : index() === state().accepted
                        ? 'resonate'
                        : 'waiting'}
                  </small>
                </span>
              )}
            </For>
          </div>
          <div>
            <Show when={!complete()}>
              <button
                class="observatory-action"
                type="button"
                onClick={hearNote}
                disabled={props.blocked || cooling()}
              >
                Hear note
              </button>
              <button
                type="button"
                disabled={props.blocked || cooling()}
                onClick={() => {
                  cancel()
                  pad.focus({ preventScroll: true })
                }}
              >
                Use keyboard
              </button>
            </Show>
            <button type="button" onClick={rebuild} disabled={props.blocked}>
              Rebuild seals
            </button>
            <button
              type="button"
              onClick={() => {
                cancel()
                props.onLeave()
              }}
            >
              Return to worlds
            </button>
          </div>
          <p id="glasswake-help">
            Drag up or down, hold the note, then release. Keyboard: ↑ ↓ tune;
            Enter holds/releases.
          </p>
        </section>
        <footer class="observatory-footer">
          <span>Desktop encounter. Headset testing is still ahead.</span>
          <div class="observatory-sound-controls">
            <label>
              Volume{' '}
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={props.sound?.volume ?? 0.55}
                onInput={(event) => {
                  props.audio.setVolume(event.currentTarget.valueAsNumber)
                }}
              />
            </label>
            <button
              type="button"
              aria-pressed={muted()}
              onClick={() => {
                cancel()
                setMuted(!muted())
              }}
            >
              {muted() ? 'Instrument sound' : 'Mute instrument'}
            </button>
            <button
              type="button"
              aria-pressed={!props.motion}
              onClick={() => {
                props.onMotion()
              }}
            >
              {props.motion ? 'Pause motion' : 'Resume motion'}
            </button>
          </div>
        </footer>
        <Show when={props.sound?.error}>
          <p class="observatory-audio-error" role="alert">
            {props.sound?.error}
          </p>
        </Show>
      </div>
    </>
  )
}

declare global {
  interface Window {
    __glasswake?: {
      readonly state: ReturnType<typeof createGlasswakeEncounter>
      readonly time: number
      readonly burstTimes: readonly number[]
      readonly cooling: boolean
    }
  }
}
