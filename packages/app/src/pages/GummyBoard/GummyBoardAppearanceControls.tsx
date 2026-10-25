/** Per-piece colors, display scale and rendering quality in the board's scrollable sidebar. */
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import { createGummyBoardPieces, getGummyBoardPiecePalette, } from '@/components/GummyBoard/gummyBoardChoreography'
import { GUMMY_BOARD_PALETTES } from './gummyBoardAppearance'
import styles from './GummyBoardAppearanceControls.module.css'
import type { GummyBoardAppearance, GummyBoardQuality, } from './gummyBoardAppearance'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'

export function GummyBoardAppearanceControls(props: {
  appearance: GummyBoardAppearance
  selectedPieceId: number | undefined
  basePalette: GummyPalette
  disabled: boolean
  storageError?: string
  onSelectPiece: (id: number | undefined) => void
  onChange: (patch: Partial<GummyBoardAppearance>) => void
}) {
  const pieces = createGummyBoardPieces()
  const [open, setOpen] = createSignal(false)
  createEffect(
    on(
      () => props.selectedPieceId,
      (id) => {
        if (id !== undefined) setOpen(true)
      },
    ),
  )
  const selected = createMemo(() =>
    pieces.find((piece) => piece.id === props.selectedPieceId),
  )
  const palette = createMemo(() => {
    const piece = selected()
    return piece
      ? getGummyBoardPiecePalette(
          piece,
          props.basePalette,
          props.appearance.paletteOverrides,
        )
      : props.basePalette
  })
  return (
    <details
      class={styles.panel}
      open={open()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Board appearance</summary>
      <fieldset disabled={props.disabled} class={styles.content}>
        <p class={styles.help}>
          16 pawns, 4 rooks, 4 knights, 4 bishops, 2 queens and 2 kings.
        </p>
        <p class={styles.help}>
          Tap a piece without dragging in Orbit mode, or choose it here. Colors
          and size update live. Piece labels use their opening squares.
        </p>
        <label class={styles.label} for="gummy-board-piece">
          Piece
        </label>
        <select
          id="gummy-board-piece"
          class={styles.select}
          value={
            props.selectedPieceId === undefined
              ? ''
              : String(props.selectedPieceId)
          }
          onChange={(event) => {
            props.onSelectPiece(
              event.currentTarget.value
                ? Number(event.currentTarget.value)
                : undefined,
            )
          }}
        >
          <option value="">Choose a piece</option>
          <For each={pieces}>
            {(piece) => (
              <option value={String(piece.id)}>
                {piece.side === 0 ? 'White' : 'Black'} {piece.mould} ·{' '}
                {piece.square}
              </option>
            )}
          </For>
        </select>
        <label class={styles.label} for="gummy-board-piece-palette">
          Piece palette
        </label>
        <select
          id="gummy-board-piece-palette"
          class={styles.select}
          disabled={!selected()}
          value={palette()}
          onChange={(event) => {
            const id = props.selectedPieceId
            if (id !== undefined)
              props.onChange({
                paletteOverrides: {
                  ...props.appearance.paletteOverrides,
                  [id]: event.currentTarget.value as GummyPalette,
                },
              })
          }}
        >
          <For each={GUMMY_BOARD_PALETTES}>
            {([value, name]) => <option value={value}>{name}</option>}
          </For>
        </select>
        <div class={styles.actions}>
          <button
            type="button"
            disabled={
              !selected() ||
              props.appearance.paletteOverrides[props.selectedPieceId!] ===
                undefined
            }
            onClick={() => {
              const id = props.selectedPieceId
              if (id === undefined) return
              const paletteOverrides = { ...props.appearance.paletteOverrides }
              delete paletteOverrides[id]
              props.onChange({ paletteOverrides })
            }}
          >
            Reset piece color
          </button>
          <button
            type="button"
            disabled={
              Object.keys(props.appearance.paletteOverrides).length === 0
            }
            onClick={() => {
              props.onChange({ paletteOverrides: {} })
            }}
          >
            Reset all colors
          </button>
        </div>
        <p class={styles.help}>
          Bishops and knights have their own starting colors. Reset restores
          each piece's default.
        </p>
        <label class={styles.sliderLabel} for="gummy-board-piece-scale">
          Piece size{' '}
          <output>{Math.round(props.appearance.pieceScale * 100)}%</output>
        </label>
        <input
          id="gummy-board-piece-scale"
          class={styles.slider}
          type="range"
          min="85"
          max="100"
          step="1"
          value={props.appearance.pieceScale * 100}
          onInput={(event) => {
            props.onChange({
              pieceScale: Number(event.currentTarget.value) / 100,
            })
          }}
        />
        <label class={styles.label} for="gummy-board-quality">
          Render quality
        </label>
        <select
          id="gummy-board-quality"
          class={styles.select}
          value={props.appearance.quality}
          onChange={(event) => {
            props.onChange({
              quality: event.currentTarget.value as GummyBoardQuality,
            })
          }}
        >
          <option value="auto">Auto</option>
          <option value="tablet">Tablet</option>
          <option value="high">High</option>
        </select>
        <p class={styles.help}>
          Auto uses Tablet on smaller screens or touch devices. Tablet uses less
          surface and lighting detail. High costs more GPU time. Physics stays
          the same; changing quality resets the take.
        </p>
        <p class={styles.help}>
          Board appearance is saved in this browser, separately from material
          presets.
        </p>
        <Show when={props.storageError}>
          <p class={styles.notice} role="status">
            {props.storageError}
          </p>
        </Show>
      </fieldset>
    </details>
  )
}
