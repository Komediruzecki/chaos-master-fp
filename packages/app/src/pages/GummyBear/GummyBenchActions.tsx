/** Shared playback and camera controls for the desktop and compact gummy workbench. */
import { For, Show } from 'solid-js'
import { Pause, PlayPause, Reset } from '@/icons'
import styles from './GummyBearPage.module.css'
import type { GummyBench } from './useGummyBench'

export function GummyActions(props: {
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

export function GummyBenchCameraControls(props: { bench: GummyBench }) {
  return (
    <fieldset
      class={styles.fieldset}
      disabled={!props.bench.ready() || !!props.bench.error()}
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
              aria-pressed={props.bench.mode() === choice.id}
              onClick={() => props.bench.setMode(choice.id)}
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
          checked={props.bench.pointerGuide()}
          onChange={(event) =>
            props.bench.setPointerGuide(event.currentTarget.checked)
          }
        />
        <span>Pointer guide</span>
      </label>
      <p class={styles.note}>
        Cyan to aim. Amber while holding, with a line showing the pull. Included
        in recordings.
      </p>
    </fieldset>
  )
}
