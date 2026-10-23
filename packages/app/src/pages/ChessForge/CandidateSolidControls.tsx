/** Material controls and measured occupancy diagnostics for finite chess candidates. */
import { For, Show } from 'solid-js'
import { CHESS_CANDIDATE_SOLID_MAX_THICKNESS, CHESS_CANDIDATE_SOLID_MIN_THICKNESS, CHESS_CANDIDATE_SOLID_SPACINGS, } from '@/flame/chess/chessCandidate'
import { GUMMY_BOARD_PALETTES } from '../GummyBoard/gummyBoardAppearance'
import styles from '../Pawn/PawnPage.module.css'
import ui from './ChessForgePage.module.css'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { ChessCandidateSolid } from '@/flame/chess/chessCandidate'
import type { CandidateSolidReport } from '@/simulation/gummy/gummyAffineIfsVolume'

export function CandidateSolidControls(props: {
  settings: ChessCandidateSolid
  onChange: (settings: ChessCandidateSolid) => void
  palette: GummyPalette
  onPalette: (palette: GummyPalette) => void
  report?: CandidateSolidReport
  busy: boolean
  error: string
}) {
  return (
    <details open class={ui.section}>
      <summary>Finite material</summary>
      <p class={styles.note}>
        Give the fractal thickness, then inspect the surface beside a classic
        pawn. Both pieces use the board’s 0.9× scale.
      </p>
      <label class={styles.sliderField}>
        <span class={styles.fieldTitle}>
          Material thickness
          <output>{props.settings.thickness.toFixed(3)}</output>
        </span>
        <input
          aria-label="Material thickness"
          type="range"
          min={CHESS_CANDIDATE_SOLID_MIN_THICKNESS}
          max={CHESS_CANDIDATE_SOLID_MAX_THICKNESS}
          step="0.005"
          value={props.settings.thickness}
          onInput={(event) => {
            props.onChange({
              ...props.settings,
              thickness: event.currentTarget.valueAsNumber,
            })
          }}
        />
      </label>
      <label class={styles.selectField}>
        Material sampling
        <select
          aria-label="Material sampling"
          value={props.settings.spacing}
          onChange={(event) => {
            props.onChange({
              ...props.settings,
              spacing: Number(
                event.currentTarget.value,
              ) as ChessCandidateSolid['spacing'],
            })
          }}
        >
          <For each={CHESS_CANDIDATE_SOLID_SPACINGS}>
            {(spacing) => (
              <option value={spacing}>
                {spacing === 0.04
                  ? 'Fine'
                  : spacing === 0.06
                    ? 'Medium'
                    : 'Board density'}{' '}
                · {spacing.toFixed(2)}
              </option>
            )}
          </For>
        </select>
      </label>
      <label class={styles.selectField}>
        Preview palette
        <select
          aria-label="Preview palette"
          value={props.palette}
          onChange={(event) => {
            props.onPalette(event.currentTarget.value as GummyPalette)
          }}
        >
          <For each={GUMMY_BOARD_PALETTES}>
            {([value, label]) => <option value={value}>{label}</option>}
          </For>
        </select>
      </label>
      <p class={styles.note}>
        Finer sampling keeps smaller openings and costs more to simulate. This
        preview uses the board’s surface reconstruction; it does not run the
        physics.
      </p>
      <Show when={props.busy}>
        <p role="status" class={ui.notice}>
          Building material and measuring its support…
        </p>
      </Show>
      <Show when={props.error}>
        <p role="alert" class={ui.notice}>
          {props.error}
        </p>
      </Show>
      <Show when={props.report}>
        {(report) => (
          <div data-testid="candidate-solid-report">
            <dl class={ui.measurements}>
              <div>
                <dt>Material cells</dt>
                <dd>{report().particleCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Connected regions</dt>
                <dd>{report().componentCount}</dd>
              </div>
              <div>
                <dt>Largest region</dt>
                <dd>{(100 * report().largestComponentFraction).toFixed(1)}%</dd>
              </div>
              <div>
                <dt>Footprint at board scale</dt>
                <dd>
                  {(
                    (report().bounds.max[0] - report().bounds.min[0]) *
                    0.9
                  ).toFixed(2)}{' '}
                  ×{' '}
                  {(
                    (report().bounds.max[2] - report().bounds.min[2]) *
                    0.9
                  ).toFixed(2)}
                </dd>
              </div>
              <div>
                <dt>Height at board scale</dt>
                <dd>
                  {(
                    (report().bounds.max[1] - report().bounds.min[1]) *
                    0.9
                  ).toFixed(2)}
                </dd>
              </div>
              <div>
                <dt>Base contact cells</dt>
                <dd>{report().baseCellCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Centre above support</dt>
                <dd>{report().centerSupported ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
            <For each={report().warnings}>
              {(warning) => <p class={ui.notice}>{warning}</p>}
            </For>
            <p class={styles.note}>
              Measurements describe the occupied material cells. Surface
              smoothing can bridge gaps; inspect the rendered openings too. Base
              support is a static check, not a stability test under impact.
            </p>
          </div>
        )}
      </Show>
    </details>
  )
}
