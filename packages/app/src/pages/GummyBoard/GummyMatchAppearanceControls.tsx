/** Board finish, render quality and reusable gummy materials for a local match. */
import { GummyPresetControls } from '../GummyBear/GummyPresetControls'
import { createGummyPreset } from '../GummyBear/gummyPresets'
import { GummyMatchLookCards } from './GummyMatchLookCards'
import styles from './GummyMatchPage.module.css'
import { GummyPawnSelectionControls } from './GummyPawnSelectionControls'
import type { GummyPresetSettings } from '../GummyBear/gummyPresets'
import type { useGummyMatch } from './useGummyMatch'
import type { GummyBoardQuality } from '@/components/GummyBoard/gummyBoardQuality'
import type { GummyBoardTheme } from '@/components/GummyBoard/gummyBoardThemes'

export function GummyMatchAppearanceControls(props: {
  match: ReturnType<typeof useGummyMatch>
  busy: boolean
}) {
  const settings = () => props.match.appearance().settings
  const theme = () => props.match.appearance().theme
  const quality = () => props.match.appearance().quality
  const scale = () => props.match.appearance().scale
  const setSettings = (settings: GummyPresetSettings) => {
    props.match.updateAppearance({ settings })
  }
  const setTheme = (theme: GummyBoardTheme) => {
    props.match.updateAppearance({ theme })
  }
  const setQuality = (quality: GummyBoardQuality) => {
    props.match.updateAppearance({ quality })
  }
  const setScale = (scale: number) => {
    props.match.updateAppearance({ scale })
  }
  return (
    <>
      <GummyMatchLookCards
        palette={settings().palette}
        theme={theme()}
        busy={props.busy}
        onPalette={(palette) => {
          if (!props.busy) setSettings({ ...settings(), palette })
        }}
        onTheme={setTheme}
      />
      <GummyPawnSelectionControls
        value={props.match.appearance().authoredPawn}
        disabled={props.busy}
        onChange={(authoredPawn) => {
          if (!props.busy) props.match.updateAppearance({ authoredPawn })
        }}
      />
      <details class={styles.section}>
        <summary>Board and material</summary>
        <fieldset class={styles.fields} disabled={props.busy}>
          <label class={styles.label} for="match-theme">
            Board
          </label>
          <select
            id="match-theme"
            class={styles.select}
            value={theme()}
            onChange={(event) => {
              setTheme(event.currentTarget.value as GummyBoardTheme)
            }}
          >
            <option value="classic">Classic</option>
            <option value="glass">Glass</option>
            <option value="lava">Lava</option>
          </select>
          <label class={styles.label} for="match-quality">
            Render quality
          </label>
          <select
            id="match-quality"
            class={styles.select}
            value={quality()}
            onChange={(event) => {
              setQuality(event.currentTarget.value as GummyBoardQuality)
            }}
          >
            <option value="auto">Auto</option>
            <option value="tablet">Tablet</option>
            <option value="high">High</option>
          </select>
          <label class={styles.sliderLabel} for="match-scale">
            Piece size <output>{Math.round(scale() * 100)}%</output>
          </label>
          <input
            id="match-scale"
            class={styles.slider}
            type="range"
            min="85"
            max="100"
            step="1"
            value={scale() * 100}
            onInput={(event) => {
              setScale(Number(event.currentTarget.value) / 100)
            }}
          />
          <p class={styles.help}>
            Captures use the chosen gummy material. Castling, en-passant and
            promotion use short move animations.
          </p>
        </fieldset>
        <div class={styles.materialPresets}>
          <GummyPresetControls
            current={settings()}
            disabled={props.busy}
            onApply={(next) => {
              if (!props.busy)
                setSettings(createGummyPreset('Match material', next).settings)
            }}
          />
        </div>
      </details>
    </>
  )
}
