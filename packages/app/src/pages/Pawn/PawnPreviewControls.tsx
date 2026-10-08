/** Explicit source/surface comparison and view-only board material settings. */
import { For, Show } from 'solid-js'
import { GUMMY_BOARD_PALETTES } from '@/pages/GummyBoard/gummyBoardAppearance'
import styles from './PawnPage.module.css'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { GummyBoardQuality } from '@/components/GummyBoard/gummyBoardQuality'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

export function PawnPreviewControls(props: {
  view: 'source' | 'surface'
  version: GummyAuthoredPawn['version']
  palette: GummyPalette
  quality: GummyBoardQuality
  onView: (view: 'source' | 'surface') => void
  onVersion: (version: GummyAuthoredPawn['version']) => void
  onPalette: (palette: GummyPalette) => void
  onQuality: (quality: GummyBoardQuality) => void
}) {
  return (
    <fieldset class={styles.formField}>
      <legend>Inspect for chess</legend>
      <div class={styles.sideOptions}>
        <For each={['surface', 'source'] as const}>
          {(view) => (
            <label class={styles.sideOption}>
              <input
                type="radio"
                name="pawn-preview"
                checked={props.view === view}
                onChange={() => {
                  props.onView(view)
                }}
              />
              <span>
                {view === 'surface' ? 'Playable surface' : 'Fractal source'}
              </span>
            </label>
          )}
        </For>
      </div>
      <label class={styles.selectField}>
        Shape version
        <select
          aria-label="Shape version"
          value={props.version}
          onChange={(event) => {
            props.onVersion(
              Number(event.currentTarget.value) as GummyAuthoredPawn['version'],
            )
          }}
        >
          <option value="2">Open crown · new</option>
          <option value="1">Original lattice · preserved</option>
        </select>
      </label>
      <Show when={props.view === 'surface'}>
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
        <label class={styles.selectField}>
          Preview lighting
          <select
            aria-label="Preview lighting"
            value={props.quality}
            onChange={(event) => {
              props.onQuality(event.currentTarget.value as GummyBoardQuality)
            }}
          >
            <option value="auto">Automatic</option>
            <option value="tablet">Tablet</option>
            <option value="high">High</option>
          </select>
        </label>
        <p class={styles.note}>
          The same resting surface used on the board. Palette and lighting are
          preview settings; choose your game colours in Chess.
        </p>
      </Show>
    </fieldset>
  )
}
