// User-initiated soundtrack controls and a bounded response, shared by both eyes.
import { For, Show } from 'solid-js'
import { TRACK } from './audio'
import type { LabRuntime } from './runtime'

const stamp = (seconds = 0) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export function MusicControls(props: {
  state?: ReturnType<LabRuntime['snapshot']>
  runtime: () => LabRuntime | undefined
  update: () => void
}) {
  const music = () => props.state?.music
  const ready = () => props.state?.ready ?? false
  const strength = () => props.state?.motionStrength ?? 0.65
  const volume = () => music()?.volume ?? 0.55
  const muted = () => music()?.muted ?? false
  const stationary = () => strength() === 0 && props.state?.paused
  const playing = () => music()?.status === 'playing'
  const busy = () => !ready() || music()?.status === 'loading'
  return (
    <section class="music-controls" aria-label="Music and motion">
      <p class="eyebrow">LISTEN / {TRACK.title.toUpperCase()}</p>
      <p class="track-caption">{TRACK.credit}. A 48-second loop.</p>
      <div class="button-row">
        <button
          class="play"
          disabled={busy()}
          onClick={() => {
            if (playing()) props.runtime()?.pauseMusic()
            else void props.runtime()?.playMusic()
          }}
        >
          {music()?.status === 'loading'
            ? 'Loading music…'
            : playing()
              ? 'Pause music'
              : 'Play music'}
        </button>
        <button
          disabled={busy()}
          onClick={() => void props.runtime()?.playMusic(true)}
        >
          Restart track
        </button>
        <button
          disabled={busy()}
          aria-pressed={muted()}
          onClick={() => {
            props.runtime()?.audio.setMuted(!muted())
            props.update()
          }}
        >
          {muted() ? 'Unmute' : 'Mute'}
        </button>
      </div>
      <div class="transport">
        <span>{music()?.status ?? 'idle'}</span>
        <span>
          {stamp(music()?.elapsed)} / {stamp(music()?.duration)}
        </span>
      </div>
      <label>
        Volume <span>{Math.round(volume() * 100)}%</span>
        <input
          aria-label="Volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume()}
          disabled={!ready()}
          onInput={(event) => {
            props.runtime()?.audio.setVolume(event.currentTarget.valueAsNumber)
            props.update()
          }}
        />
      </label>
      <label>
        Music motion <span>{Math.round(strength() * 100)}%</span>
        <input
          aria-label="Music motion"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={strength()}
          disabled={!ready()}
          onInput={(event) =>
            props
              .runtime()
              ?.setMotionStrength(event.currentTarget.valueAsNumber)
          }
        />
      </label>
      <button
        class="stationary"
        disabled={!ready()}
        aria-pressed={stationary()}
        onClick={() => props.runtime()?.setMotionStrength(0)}
      >
        Stationary view
      </button>
      <div class="band-meters" aria-label="Smoothed music energy">
        <For each={['low', 'mid', 'high'] as const}>
          {(band) => (
            <label>
              {band}
              <meter
                min="0"
                max="1"
                value={props.state?.musicFrame[band] ?? 0}
                aria-label={`${band} energy`}
              />
            </label>
          )}
        </For>
      </div>
      <p class="hint">
        Pause holds the musical shape. Mute keeps it dancing. Stationary view
        removes the response and stops rotation.
      </p>
      <Show when={music()?.error}>
        <p role="alert">{music()?.error}</p>
      </Show>
    </section>
  )
}
