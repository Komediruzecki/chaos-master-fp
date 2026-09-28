// The Comfort control of the Audio Reactive panel: how fast audio may move
// the picture (calm, standard, intense). One choice for every modulation.
import { For } from 'solid-js'
import { comfortPreset, setComfortPreset } from '@/comfort/comfortPreference'
import { COMFORT_PRESET_DESCRIPTIONS, COMFORT_PRESET_LABELS, COMFORT_PRESETS, } from '@/comfort/comfortPresets'
import ui from './AudioReactivePanel.module.css'

export function ComfortPresetControl() {
  return (
    <div>
      <div class={ui.sectionLabel}>Comfort</div>
      <div class={ui.presetRow} role="radiogroup" aria-label="Comfort limits">
        <For each={COMFORT_PRESETS}>
          {(preset) => (
            <button
              class={
                ui.presetBtn +
                (comfortPreset() === preset ? ` ${ui.presetBtnActive}` : '')
              }
              onClick={() => {
                setComfortPreset(preset)
              }}
              title={COMFORT_PRESET_DESCRIPTIONS[preset]}
              role="radio"
              aria-checked={comfortPreset() === preset}
            >
              {COMFORT_PRESET_LABELS[preset]}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
