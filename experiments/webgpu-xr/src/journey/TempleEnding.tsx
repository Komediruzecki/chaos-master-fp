// The ending keeps its listening controls at the edge of the existing 3D scene.
import './temple.css'
import { createMemo, For, onMount, Show } from 'solid-js'
import { Icon } from '../theme/Icon'
import { JourneySaveStatus } from './JourneyPanels'
import { TEMPLE_DURATION_SECONDS, templeCue } from './templeScore'
import type { JourneyPersistence } from './progress'
import type { TemplePhase } from './useTempleEnding'

const sections = [
  { id: 'glasswake', label: 'Glasswake', detail: 'C Ionian' },
  { id: 'tideweave', label: 'Tideweave', detail: 'D Dorian' },
  { id: 'together', label: 'Together', detail: 'Glass + reed' },
  { id: 'threshold', label: 'Threshold', detail: 'The answer' },
] as const

export function TempleEnding(props: {
  phase: TemplePhase
  progress: number
  ready: boolean
  motion: boolean
  volume: number
  error?: string | null
  persistence: JourneyPersistence
  onPlay: () => void
  onStop: () => void
  onLeave: () => void
  onMotion: () => void
  onVolume: (value: number) => void
}) {
  let listen!: HTMLButtonElement
  const busy = createMemo(
    () => props.phase === 'playing' || props.phase === 'loading',
  )
  const cue = createMemo(() => templeCue(props.progress))
  const section = createMemo(() =>
    sections.findIndex((entry) => entry.id === cue().section),
  )
  const status = createMemo(() => {
    if (props.phase === 'ready')
      return 'Your two pages carry a shared signal. Listen to follow it.'
    if (props.phase === 'loading') return 'Preparing the passage…'
    if (props.phase === 'stopped')
      return 'Passage stopped. Replay begins from the first note.'
    if (props.phase === 'error')
      return 'Sound could not start. Try listening again.'
    if (props.phase === 'complete')
      return 'The temple has answered. Its doors are for another visit.'
    return cue().section === 'glasswake'
      ? 'Glasswake calls. A crown of glass remembers its first light.'
      : cue().section === 'tideweave'
        ? 'Tideweave answers. The reed rises towards its sixth.'
        : cue().section === 'together'
          ? 'Two forms meet. Their notes draw a path between the stars.'
          : 'A shared seal takes shape at the temple threshold.'
  })
  onMount(() => {
    queueMicrotask(() => {
      listen.focus({ preventScroll: true })
    })
  })
  return (
    <section
      class="temple-ending"
      aria-labelledby="temple-title"
      data-phase={props.phase}
      data-section={cue().section}
    >
      <div class="temple-copy">
        <p class="observatory-place">Irchiinnuss · The first confluence</p>
        <h1 id="temple-title">
          {props.phase === 'complete'
            ? 'The temple answers'
            : 'Two worlds, one answer'}
        </h1>
        <p class="temple-status" role="status">
          {status()}
        </p>
        <Show when={props.phase === 'ready'}>
          <p class="temple-caption">
            A 27-second passage. Glasswake, Tideweave, then both together.
          </p>
        </Show>
      </div>
      <div class="temple-transport">
        <ol class="temple-score" aria-label="Passage sections">
          <For each={sections}>
            {(entry, index) => (
              <li
                data-tone={entry.id}
                classList={{
                  'is-current': entry.id === cue().section && busy(),
                  'is-past': props.phase === 'complete' || index() < section(),
                }}
              >
                <span>{entry.label}</span>
                <small>{entry.detail}</small>
              </li>
            )}
          </For>
        </ol>
        <div class="temple-time">
          <progress
            max="1"
            value={props.progress}
            aria-label="Musical passage progress"
          />
          <span>
            {props.phase === 'complete'
              ? Math.ceil(TEMPLE_DURATION_SECONDS)
              : Math.floor(props.progress * TEMPLE_DURATION_SECONDS)}{' '}
            / {Math.ceil(TEMPLE_DURATION_SECONDS)} s
          </span>
        </div>
        <div class="temple-actions">
          <button
            ref={listen}
            type="button"
            class="observatory-action lx-primary"
            disabled={!props.ready && !busy()}
            onClick={() => {
              if (busy()) props.onStop()
              else props.onPlay()
            }}
          >
            <Icon name={busy() ? 'stop' : 'play'} />
            {busy()
              ? 'Stop ending'
              : props.phase === 'ready'
                ? 'Listen together'
                : 'Replay ending'}
          </button>
          <button class="lx-tertiary" type="button" onClick={props.onLeave}>
            Return to worlds
          </button>
        </div>
      </div>
      <footer class="temple-footer">
        <JourneySaveStatus persistence={props.persistence} />
        <div class="observatory-sound-controls">
          <label>
            Volume{' '}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={props.volume}
              onInput={(event) => {
                props.onVolume(event.currentTarget.valueAsNumber)
              }}
            />
          </label>
          <button
            type="button"
            aria-pressed={!props.motion}
            onClick={props.onMotion}
          >
            {props.motion ? 'Pause motion' : 'Resume motion'}
          </button>
        </div>
      </footer>
      <Show when={props.error}>
        <p class="temple-error" role="alert">
          {props.error}
        </p>
      </Show>
    </section>
  )
}
