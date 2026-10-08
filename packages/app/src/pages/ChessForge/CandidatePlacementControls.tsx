/** Manual fitting is kept separate from the immutable source's iterative maps. */
import { For } from 'solid-js'
import styles from '../Pawn/PawnPage.module.css'
import type { ChessCandidate } from '@/flame/chess/chessCandidate'

const AXES = [
  { index: 0, label: 'X' },
  { index: 1, label: 'Y' },
  { index: 2, label: 'Z' },
] as const

export function CandidatePlacementControls(props: {
  placement: ChessCandidate['placement']
  onChange: (placement: ChessCandidate['placement']) => void
}) {
  const setAxis = (
    field: 'rotation' | 'offset',
    axis: number,
    value: number,
  ) => {
    const next: [number, number, number] = [...props.placement[field]]
    next[axis] = value
    props.onChange({ ...props.placement, [field]: next })
  }
  return (
    <>
      <For each={AXES}>
        {(axis) => (
          <label class={styles.sliderField}>
            <span class={styles.fieldTitle}>
              Rotate {axis.label}
              <output>
                {Math.round(
                  (props.placement.rotation[axis.index] * 180) / Math.PI,
                )}
                °
              </output>
            </span>
            <input
              aria-label={`Rotate ${axis.label}`}
              type="range"
              min="-180"
              max="180"
              step="1"
              value={(props.placement.rotation[axis.index] * 180) / Math.PI}
              onInput={(event) => {
                setAxis(
                  'rotation',
                  axis.index,
                  (event.currentTarget.valueAsNumber * Math.PI) / 180,
                )
              }}
            />
          </label>
        )}
      </For>
      <label class={styles.sliderField}>
        <span class={styles.fieldTitle}>
          Scale<output>{props.placement.scale.toFixed(2)}×</output>
        </span>
        <input
          aria-label="Inspection scale"
          type="range"
          min="0.05"
          max="5"
          step="0.01"
          value={props.placement.scale}
          onInput={(event) => {
            props.onChange({
              ...props.placement,
              scale: event.currentTarget.valueAsNumber,
            })
          }}
        />
      </label>
      <For each={AXES}>
        {(axis) => (
          <label class={styles.sliderField}>
            <span class={styles.fieldTitle}>
              Position {axis.label}
              <output>{props.placement.offset[axis.index].toFixed(2)}</output>
            </span>
            <input
              aria-label={`Position ${axis.label}`}
              type="range"
              min="-3"
              max="3"
              step="0.01"
              value={props.placement.offset[axis.index]}
              onInput={(event) => {
                setAxis('offset', axis.index, event.currentTarget.valueAsNumber)
              }}
            />
          </label>
        )}
      </For>
      <button
        type="button"
        class={styles.secondaryButton}
        onClick={() => {
          props.onChange({ rotation: [0, 0, 0], scale: 1, offset: [0, 0, 0] })
        }}
      >
        Reset fit
      </button>
      <p class={styles.note}>
        Rotation applies X, then Y, then Z. This fit changes the inspection
        copy; your original fractal stays intact.
      </p>
    </>
  )
}
