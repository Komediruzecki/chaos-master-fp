/** Record, finish and download a canvas take from either responsive control host. */
import { createUniqueId, Show } from 'solid-js'
import styles from './GummyRecordingControls.module.css'
import type { GummyRecording } from './useGummyRecording'

function time(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)
    .toString()
    .padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`
}

export function GummyRecordingControls(props: {
  recording: GummyRecording
  ready: boolean
  onStart: () => void
}) {
  const qualityId = createUniqueId()
  return (
    <fieldset class={styles.recording} aria-label="Canvas recording">
      <legend>Record a clip</legend>
      <label class={styles.qualityLabel} for={qualityId}>
        Recording quality
      </label>
      <select
        id={qualityId}
        class={styles.qualitySelect}
        value={props.recording.quality()}
        disabled={props.recording.busy()}
        aria-describedby={`${qualityId}-help`}
        onChange={(event) => {
          const value = event.currentTarget.value
          if (value === 'high' || value === 'standard')
            props.recording.setQuality(value)
        }}
      >
        <option value="high">High · 60 fps target</option>
        <option value="standard">Standard · 30 fps target</option>
      </select>
      <p id={`${qualityId}-help`} class={styles.qualityHelp}>
        {props.recording.quality() === 'high'
          ? 'More detail, larger files. Use Standard if recording stutters.'
          : 'Less work for the encoder. Useful on phones and tablets.'}{' '}
        Records the canvas pixels. Frame rate depends on playback speed and your
        browser.
      </p>
      <div class={styles.row}>
        <button
          type="button"
          class={styles.recordButton}
          data-recording={props.recording.busy()}
          disabled={
            props.recording.state() === 'stopping' ||
            (!props.recording.busy() &&
              (!props.ready || !props.recording.supported()))
          }
          onClick={() => {
            if (props.recording.busy()) props.recording.stop()
            else props.onStart()
          }}
        >
          {props.recording.state() === 'stopping'
            ? 'Finishing…'
            : props.recording.busy()
              ? 'Stop recording'
              : 'Record'}
        </button>
        <output class={styles.timer} aria-label="Recording time">
          {time(props.recording.elapsed())}
        </output>
      </div>
      <Show when={props.recording.busy() && props.recording.capture()}>
        {(capture) => (
          <p class={styles.captureInfo}>
            {capture().width} × {capture().height} ·{' '}
            {capture().requestedFrameRate} fps target ·{' '}
            {(capture().requestedBitsPerSecond / 1_000_000).toFixed(1)} Mbps
            requested
          </p>
        )}
      </Show>
      <p
        class={styles.status}
        role="status"
        aria-live="polite"
        data-testid="gummy-recording-status"
        data-state={props.recording.state()}
      >
        {props.recording.error() ??
          (!props.recording.supported()
            ? 'Canvas recording is unavailable in this browser.'
            : props.recording.state() === 'recording'
              ? 'Recording the canvas. Play with the gummy and move the camera.'
              : props.recording.state() === 'stopping'
                ? 'Finishing your video…'
                : props.recording.state() === 'ready'
                  ? (props.recording.clip()?.reason ??
                    'Your clip is ready to download.')
                  : 'Canvas only, no audio. Stops at 2 minutes or 128 MB.')}
      </p>
      <Show when={props.recording.clip()}>
        {(clip) => (
          <div class={styles.saved}>
            <button
              class={styles.downloadButton}
              type="button"
              disabled={props.recording.busy()}
              onClick={() => {
                props.recording.download()
              }}
            >
              Download video
            </button>
            <span>
              {clip().extension.toUpperCase()} · {time(clip().durationSeconds)}{' '}
              · {(clip().blob.size / 1024 / 1024).toFixed(1)} MB
            </span>
            <span>
              {clip().capture.width} × {clip().capture.height} ·{' '}
              {clip().capture.requestedFrameRate} fps target ·{' '}
              {(
                (clip().encoderBitsPerSecond ??
                  clip().capture.requestedBitsPerSecond) / 1_000_000
              ).toFixed(1)}{' '}
              Mbps{' '}
              {clip().encoderBitsPerSecond ? 'encoder setting' : 'requested'}
            </span>
          </div>
        )}
      </Show>
    </fieldset>
  )
}
