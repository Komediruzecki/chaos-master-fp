import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import ui from './AudioDriverPopover.module.css'
import type { AudioFeature } from '@/utils/audioAnalysis'
import type { AudioDriver } from '@/utils/audioDriver'

// ── Constants ────────────────────────────────────────────────────────────

const AUDIO_FEATURE_LABELS: Record<AudioFeature, string> = {
  subBass: 'Sub-Bass',
  bass: 'Bass',
  lowMid: 'Low-Mid',
  mid: 'Mid',
  hiMid: 'Hi-Mid',
  presence: 'Presence',
  brilliance: 'Brilliance',
  fullSpectrum: 'Full Spectrum',
  rms: 'RMS',
  centroid: 'Centroid',
  flatness: 'Flatness',
  beat: 'Beat',
  onset: 'Onset',
}

const ALL_FEATURES: AudioFeature[] = [
  'subBass',
  'bass',
  'lowMid',
  'mid',
  'hiMid',
  'presence',
  'brilliance',
  'fullSpectrum',
  'rms',
  'centroid',
  'flatness',
  'beat',
  'onset',
]

const DEFAULT_DRIVER: AudioDriver = {
  feature: 'bass',
  mode: 'multiply',
  sensitivity: 1,
  range: [0, 1],
  attackMs: 50,
  releaseMs: 200,
}

// ── Component ────────────────────────────────────────────────────────────

type AudioDriverPopoverProps = {
  x: number
  y: number
  /** The existing driver if editing, or undefined if adding new. */
  driver: AudioDriver | undefined
  onSave: (driver: AudioDriver) => void
  onRemove: () => void
  onClose: () => void
}

export function AudioDriverPopover(props: AudioDriverPopoverProps) {
  const initial = () => props.driver ?? { ...DEFAULT_DRIVER }
  const [feature, setFeature] = createSignal<AudioFeature>(initial().feature)
  const [mode, setMode] = createSignal<AudioDriver['mode']>(initial().mode)
  const [sensitivity, setSensitivity] = createSignal(initial().sensitivity)
  const [rangeLo, setRangeLo] = createSignal(initial().range[0])
  const [rangeHi, setRangeHi] = createSignal(initial().range[1])
  const [attackMs, setAttackMs] = createSignal(initial().attackMs ?? 50)
  const [releaseMs, setReleaseMs] = createSignal(initial().releaseMs ?? 200)

  const editing = () => props.driver !== undefined

  function close() {
    props.onClose()
  }

  function handleSave() {
    props.onSave({
      feature: feature(),
      mode: mode(),
      sensitivity: sensitivity(),
      range: [rangeLo(), rangeHi()],
      attackMs: attackMs() > 0 ? attackMs() : undefined,
      releaseMs: releaseMs() > 0 ? releaseMs() : undefined,
    })
    close()
  }

  function handleRemove() {
    props.onRemove()
    close()
  }

  createEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }

    function handleClick() {
      close()
    }
    setTimeout(() => {
      window.addEventListener('keydown', handleKey)
      window.addEventListener('click', handleClick)
    }, 0)
    onCleanup(() => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('click', handleClick)
    })
  })

  return (
    <Portal>
      <div
        class={ui.popover}
        style={{
          left: `${props.x}px`,
          top: `${props.y}px`,
        }}
        onClick={(e) => {
          e.stopPropagation()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
        }}
      >
        <div class={ui.header}>
          {editing() ? 'Edit Audio Driver' : 'Add Audio Driver'}
        </div>

        {/* Feature */}
        <label class={ui.field}>
          <span class={ui.label}>Feature</span>
          <select
            class={ui.select}
            value={feature()}
            onChange={(e) => setFeature(e.currentTarget.value as AudioFeature)}
          >
            {ALL_FEATURES.map((f) => (
              <option value={f}>{AUDIO_FEATURE_LABELS[f]}</option>
            ))}
          </select>
        </label>

        {/* Mode */}
        <fieldset class={ui.field}>
          <legend class={ui.label}>Mode</legend>
          <div class={ui.modeRow}>
            {(['multiply', 'add', 'replace'] as const).map((m) => (
              <label class={ui.modeOption}>
                <input
                  type="radio"
                  name="driver-mode"
                  value={m}
                  checked={mode() === m}
                  onChange={() => setMode(m)}
                />
                <span>{m}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Sensitivity */}
        <label class={ui.field}>
          <span class={ui.label}>Sensitivity: {sensitivity().toFixed(2)}</span>
          <input
            type="range"
            class={ui.slider}
            min="0"
            max="5"
            step="0.05"
            value={sensitivity()}
            onInput={(e) => setSensitivity(parseFloat(e.currentTarget.value))}
          />
        </label>

        {/* Range */}
        <fieldset class={ui.field}>
          <legend class={ui.label}>Range</legend>
          <div class={ui.rangeRow}>
            <input
              type="number"
              class={ui.numberInput}
              value={rangeLo()}
              step="0.01"
              onChange={(e) =>
                setRangeLo(parseFloat(e.currentTarget.value) || 0)
              }
            />
            <span class={ui.rangeSep}>–</span>
            <input
              type="number"
              class={ui.numberInput}
              value={rangeHi()}
              step="0.01"
              onChange={(e) =>
                setRangeHi(parseFloat(e.currentTarget.value) || 0)
              }
            />
          </div>
        </fieldset>

        {/* Attack / Release */}
        <div class={ui.envRow}>
          <label class={ui.field}>
            <span class={ui.label}>Attack: {attackMs().toFixed(0)} ms</span>
            <input
              type="range"
              class={ui.slider}
              min="0"
              max="2000"
              step="10"
              value={attackMs()}
              onInput={(e) => setAttackMs(parseFloat(e.currentTarget.value))}
            />
          </label>
          <label class={ui.field}>
            <span class={ui.label}>Release: {releaseMs().toFixed(0)} ms</span>
            <input
              type="range"
              class={ui.slider}
              min="0"
              max="2000"
              step="10"
              value={releaseMs()}
              onInput={(e) => setReleaseMs(parseFloat(e.currentTarget.value))}
            />
          </label>
        </div>

        {/* Actions */}
        <div class={ui.actions}>
          <button class={ui.btnApply} onClick={handleSave}>
            {editing() ? 'Update' : 'Add Driver'}
          </button>
          <Show when={editing()}>
            <button class={ui.btnRemove} onClick={handleRemove}>
              Remove
            </button>
          </Show>
          <button class={ui.btnCancel} onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </Portal>
  )
}
