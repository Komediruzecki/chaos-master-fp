/** Shared material and fine tuning controls for the rook-on-pawn collision study. */
import { For } from 'solid-js'
import { DEFAULT_GUMMY_PARTICLE_TUNING } from '@/simulation/gummy/gummyParticleTuning'
import { GummyTuningControls } from '../GummyBear/GummyTuningControls'
import { GUMMY_BOARD_PALETTES } from './gummyBoardAppearance'
import styles from './GummyBoardPage.module.css'
import type { Accessor, Setter } from 'solid-js'
import type { GummyPresetSettings } from '../GummyBear/gummyPresets'

export function GummyBoardMaterialControls(props: {
  settings: Accessor<GummyPresetSettings>
  setSettings: Setter<GummyPresetSettings>
  unavailable: Accessor<boolean>
  softContact: Accessor<boolean>
  warm: Accessor<boolean>
  setMaterial: (material: 'warm' | 'elastic') => void
  updateSettings: (patch: Partial<GummyPresetSettings>) => void
  setPinnedFeet: (value: boolean) => void
}) {
  return (
    <>
      <fieldset class={styles.fieldset} disabled={props.unavailable()}>
        <legend>
          {props.softContact() ? 'Piece material' : 'Pawn material'}
        </legend>
        <div
          class={styles.segments}
          role="group"
          aria-label="Particle material"
        >
          <button
            type="button"
            aria-pressed={props.warm()}
            onClick={() => {
              props.setMaterial('warm')
            }}
          >
            Warm gummy
          </button>
          <button
            type="button"
            aria-pressed={!props.warm()}
            onClick={() => {
              props.setMaterial('elastic')
            }}
          >
            Elastic jelly
          </button>
        </div>
        <label class={styles.sliderLabel} for="gummy-board-softness">
          Softness
          <output>{Math.round(props.settings().softness * 100)}%</output>
        </label>
        <input
          id="gummy-board-softness"
          class={styles.slider}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={props.settings().softness}
          onInput={(event) => {
            props.updateSettings({
              softness: Number(event.currentTarget.value),
            })
          }}
        />
        <label class={styles.sliderLabel} for="gummy-board-fragility">
          Fragility
          <output>{Math.round(props.settings().fragility * 100)}%</output>
        </label>
        <input
          id="gummy-board-fragility"
          class={styles.slider}
          type="range"
          min="0"
          max="100"
          step="1"
          value={props.settings().fragility * 100}
          onInput={(event) => {
            props.updateSettings({
              fragility: Number(event.currentTarget.value) / 100,
            })
          }}
        />
        <label class={styles.check}>
          <input
            type="checkbox"
            checked={props.settings().tearing}
            onChange={(event) => {
              props.updateSettings({ tearing: event.currentTarget.checked })
            }}
          />
          Allow tearing
        </label>
        <label class={styles.check}>
          <input
            type="checkbox"
            checked={props.settings().caustics}
            onChange={(event) => {
              props.updateSettings({ caustics: event.currentTarget.checked })
            }}
          />
          Floor caustics
        </label>
        <label class={styles.selectLabel} for="gummy-board-palette">
          Base palette
        </label>
        <select
          id="gummy-board-palette"
          class={styles.select}
          value={props.settings().palette}
          onChange={(event) => {
            props.updateSettings({
              palette: event.currentTarget
                .value as GummyPresetSettings['palette'],
            })
          }}
        >
          <For each={GUMMY_BOARD_PALETTES}>
            {([value, name]) => <option value={value}>{name}</option>}
          </For>
        </select>
      </fieldset>

      <GummyTuningControls
        tuning={props.settings().tuning}
        onTuningChange={(patch) =>
          props.setSettings((current) => ({
            ...current,
            tuning: { ...current.tuning, ...patch },
          }))
        }
        grabRadius={props.settings().grabRadius}
        onGrabRadius={(value) => {
          props.updateSettings({ grabRadius: value })
        }}
        maxPull={props.settings().maxPull}
        onMaxPull={(value) => {
          props.updateSettings({ maxPull: value })
        }}
        pinnedFeet={props.settings().pinnedFeet}
        onPinnedFeet={props.setPinnedFeet}
        warm={props.warm()}
        bear
        chessPiece
        disabled={props.unavailable()}
        onReset={() => {
          props.updateSettings({
            tuning: { ...DEFAULT_GUMMY_PARTICLE_TUNING },
            grabRadius: props.warm() ? 0.22 : 0.28,
            maxPull: 1.8,
          })
        }}
      />
    </>
  )
}
