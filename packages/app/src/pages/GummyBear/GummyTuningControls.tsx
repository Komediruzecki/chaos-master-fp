/** Live particle-jelly controls, grouped by how a drag changes the material and its motion. */
import { batch, createUniqueId, Show } from 'solid-js'
import { GUMMY_PARTICLE_TUNING_RANGES } from '../../simulation/gummy/gummyParticleTuning'
import styles from './GummyTuningControls.module.css'
import type { GummyParticleTuning } from '../../simulation/gummy/gummyParticleMath'

function TuningRange(props: {
  label: string
  help: string
  value: number
  display: string
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const id = createUniqueId()
  return (
    <div class={styles.control}>
      <label class={styles.label} for={id}>
        <span>{props.label}</span>
        <output for={id}>{props.display}</output>
      </label>
      <input
        id={id}
        class={styles.range}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        aria-describedby={`${id}-help`}
        onInput={(event) => {
          props.onChange(event.currentTarget.valueAsNumber)
        }}
      />
      <p id={`${id}-help`} class={styles.help}>
        {props.help}
      </p>
    </div>
  )
}

export function GummyTuningControls(props: {
  tuning: GummyParticleTuning
  onTuningChange: (patch: Partial<GummyParticleTuning>) => void
  grabRadius: number
  onGrabRadius: (value: number) => void
  maxPull: number
  onMaxPull: (value: number) => void
  pinnedFeet: boolean
  onPinnedFeet: (value: boolean) => void
  warm: boolean
  bear: boolean
  chessPiece?: boolean
  disabled: boolean
  onReset: () => void
}) {
  return (
    <details class={styles.tuning} data-testid="gummy-tuning-controls">
      <summary class={styles.summary}>Fine tuning</summary>
      <div class={styles.content}>
        <p class={styles.intro}>
          Adjust while you play. Sliders keep the current shape and tears.
        </p>
        <fieldset class={styles.group} disabled={props.disabled}>
          <legend>Interaction</legend>
          <TuningRange
            label="Grab radius"
            help="A smaller grip pulls a smaller patch of gummy."
            value={props.grabRadius}
            display={props.grabRadius.toFixed(2)}
            min={0.08}
            max={0.4}
            step={0.01}
            disabled={props.disabled}
            onChange={props.onGrabRadius}
          />
          <TuningRange
            label="Grab strength"
            help="Lower values let the gummy lag behind your finger."
            value={props.tuning.grabStrength}
            display={`${Math.round(props.tuning.grabStrength * 100)}%`}
            {...GUMMY_PARTICLE_TUNING_RANGES.grabStrength}
            step={0.01}
            disabled={props.disabled}
            onChange={(grabStrength) => {
              props.onTuningChange({ grabStrength })
            }}
          />
          <TuningRange
            label="Maximum pull"
            help="Limits how far each grip can stretch from its starting point."
            value={props.maxPull}
            display={props.maxPull.toFixed(2)}
            min={0.2}
            max={1.8}
            step={0.05}
            disabled={props.disabled}
            onChange={props.onMaxPull}
          />
        </fieldset>
        <Show when={props.warm}>
          <fieldset class={styles.group} disabled={props.disabled}>
            <legend>Material</legend>
            <TuningRange
              label="Flow"
              help="Higher values let warm gummy hold more of a stretch."
              value={props.tuning.flow}
              display={`${Math.round(props.tuning.flow * 100)}%`}
              {...GUMMY_PARTICLE_TUNING_RANGES.flow}
              step={0.01}
              disabled={props.disabled}
              onChange={(flow) => {
                props.onTuningChange({ flow })
              }}
            />
            <TuningRange
              label="Viscosity"
              help="Higher values damp motion within the warm gummy."
              value={props.tuning.viscosity}
              display={`${Math.round(props.tuning.viscosity * 100)}%`}
              {...GUMMY_PARTICLE_TUNING_RANGES.viscosity}
              step={0.01}
              disabled={props.disabled}
              onChange={(viscosity) => {
                props.onTuningChange({ viscosity })
              }}
            />
          </fieldset>
        </Show>
        <fieldset class={styles.group} disabled={props.disabled}>
          <legend>Motion</legend>
          <TuningRange
            label="Gravity"
            help="Zero lets loose pieces float. One is normal gravity."
            value={props.tuning.gravity}
            display={`${props.tuning.gravity.toFixed(2)}×`}
            {...GUMMY_PARTICLE_TUNING_RANGES.gravity}
            step={0.05}
            disabled={props.disabled}
            onChange={(gravity) => {
              props.onTuningChange({ gravity })
            }}
          />
          <Show when={props.warm}>
            <TuningRange
              label="Floor drag"
              help="Higher values slow pieces sliding across the floor."
              value={props.tuning.floorDrag}
              display={props.tuning.floorDrag.toFixed(1)}
              {...GUMMY_PARTICLE_TUNING_RANGES.floorDrag}
              step={0.5}
              disabled={props.disabled}
              onChange={(floorDrag) => {
                props.onTuningChange({ floorDrag })
              }}
            />
          </Show>
          <Show when={props.bear}>
            <label class={styles.checkbox}>
              <input
                type="checkbox"
                checked={props.pinnedFeet}
                disabled={props.disabled}
                onChange={(event) => {
                  props.onPinnedFeet(event.currentTarget.checked)
                }}
              />
              <span>
                {props.chessPiece ? 'Pin base to floor' : 'Pin feet to floor'}
                <small>
                  Changing this resets the {props.chessPiece ? 'piece' : 'bear'}
                  .
                </small>
              </span>
            </label>
          </Show>
        </fieldset>
        <div class={styles.actions}>
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => {
              batch(() => {
                props.onTuningChange({
                  grabStrength: 0.45,
                  flow: 0.3,
                  floorDrag: 8,
                })
                props.onGrabRadius(0.14)
                props.onMaxPull(0.65)
              })
            }}
          >
            Short pull preset
          </button>
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => {
              props.onReset()
            }}
          >
            Restore tuning
          </button>
        </div>
        <p class={styles.help}>
          Short pull uses a smaller, weaker grip. In warm jelly, it also reduces
          flow and increases floor drag. Restore tuning keeps your current
          gummy.
        </p>
      </div>
    </details>
  )
}
