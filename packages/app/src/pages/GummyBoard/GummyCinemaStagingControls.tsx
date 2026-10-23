/** Draft appearance, motion and position controls for a staged cinema shot. */
import { For } from 'solid-js'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
import { GUMMY_BOARD_PALETTES } from './gummyBoardAppearance'
import { updateGummyCinemaCaptureContext } from './gummyCinemaDraft'
import { GummyCinemaMotionControls } from './GummyCinemaMotionControls'
import styles from './GummyCinemaPage.module.css'
import { GummyCinemaSection } from './GummyCinemaSection'
import { GummyPawnSelectionControls } from './GummyPawnSelectionControls'
import type { Accessor, Setter } from 'solid-js'
import type { GummyCinemaRecipe } from './gummyCinemaRecipe'
import type { GummyBoardShotMotion } from '@/components/GummyBoard/gummyBoardShots'
import type { GummyCaptureMechanicId } from '@/components/GummyBoard/gummyCaptureMechanics'

export type GummyCinemaSections = {
  examples: boolean
  appearance: boolean
  camera: boolean
  motion: boolean
  shear: boolean
  position: boolean
  recipe: boolean
  videoExport: boolean
}

export function GummyCinemaStagingControls(props: {
  draft: Accessor<GummyCinemaRecipe>
  onDraft: Setter<GummyCinemaRecipe>
  busy: Accessor<boolean>
  sections: Accessor<GummyCinemaSections>
  sectionProps: (key: keyof GummyCinemaSections) => {
    open: boolean
    onToggle: (open: boolean) => void
  }
  onShot: (
    key: 'fen' | 'from' | 'to' | 'boardTheme' | 'cameraStyle',
    value: string,
  ) => void
  onMotion: (motion: Readonly<GummyBoardShotMotion>) => void
  onMechanic: (id: GummyCaptureMechanicId) => void
  onApply: () => void
}) {
  return (
    <fieldset class={styles.fields} disabled={props.busy()}>
      <legend>Stage the shot</legend>
      <GummyCinemaSection
        title="Pieces and board"
        {...props.sectionProps('appearance')}
      >
        <label for="cinema-art">Piece design</label>
        <select
          id="cinema-art"
          value={props.draft().artStyle}
          onChange={(e) =>
            props.onDraft((r) => ({
              ...r,
              artStyle: e.currentTarget.value as GummyCinemaRecipe['artStyle'],
            }))
          }
        >
          <option value="sculpted">Sculpted candy</option>
          <option value="classic">Original moulds</option>
        </select>
        <GummyPawnSelectionControls
          value={props.draft().authoredPawn}
          disabled={props.busy()}
          tone="light"
          onChange={(authoredPawn) =>
            props.onDraft((r) => ({ ...r, version: 3, authoredPawn }))
          }
        />
        <label for="cinema-board">Board finish</label>
        <select
          id="cinema-board"
          value={props.draft().shot.boardTheme}
          onChange={(e) => {
            props.onShot('boardTheme', e.currentTarget.value)
          }}
        >
          <option value="classic">Ivory studio</option>
          <option value="glass">Smoked sea-glass</option>
          <option value="lava">Obsidian lava</option>
        </select>
        <label for="cinema-attacker-palette">Attacking piece color</label>
        <select
          id="cinema-attacker-palette"
          value={props.draft().attackerPalette}
          onChange={(e) =>
            props.onDraft((r) => ({
              ...r,
              attackerPalette: e.currentTarget
                .value as GummyCinemaRecipe['attackerPalette'],
            }))
          }
        >
          <For each={GUMMY_BOARD_PALETTES}>
            {(p) => <option value={p[0]}>{p[1]}</option>}
          </For>
        </select>
        <label for="cinema-victim-palette">Captured piece color</label>
        <select
          id="cinema-victim-palette"
          value={props.draft().victimPalette}
          onChange={(e) =>
            props.onDraft((r) => ({
              ...r,
              victimPalette: e.currentTarget
                .value as GummyCinemaRecipe['victimPalette'],
            }))
          }
        >
          <For each={GUMMY_BOARD_PALETTES}>
            {(p) => <option value={p[0]}>{p[1]}</option>}
          </For>
        </select>
        <label for="cinema-material">Material</label>
        <select
          id="cinema-material"
          value={props.draft().shot.presetId}
          onChange={(e) => {
            const preset = GUMMY_BUILTIN_PRESETS.find(
              (p) => p.id === e.currentTarget.value,
            )!
            props.onDraft((r) => ({
              ...r,
              shot: { ...r.shot, presetId: preset.id },
              material: structuredClone(preset.preset.settings),
            }))
          }}
        >
          <option value="custom" disabled>
            Custom material
          </option>
          <For each={GUMMY_BUILTIN_PRESETS}>
            {(p) => <option value={p.id}>{p.label}</option>}
          </For>
        </select>
        <label for="cinema-size">
          Piece size: {Math.round(props.draft().scale * 100)}%
        </label>
        <input
          id="cinema-size"
          type="range"
          min="0.85"
          max="1"
          step="0.01"
          value={props.draft().scale}
          onInput={(e) =>
            props.onDraft((r) =>
              updateGummyCinemaCaptureContext(r, {
                scale: Number(e.currentTarget.value),
              }),
            )
          }
        />
      </GummyCinemaSection>
      <GummyCinemaSection
        title="Camera and quality"
        {...props.sectionProps('camera')}
      >
        <label for="cinema-camera">Camera movement</label>
        <select
          id="cinema-camera"
          value={props.draft().shot.cameraStyle}
          onChange={(e) => {
            props.onShot('cameraStyle', e.currentTarget.value)
          }}
        >
          <option value="arc">Orbit and push in</option>
          <option value="diagonal">Diagonal tracking</option>
          <option value="hero">Low hero arc</option>
        </select>
        <label for="cinema-quality">Render quality</label>
        <select
          id="cinema-quality"
          value={props.draft().quality}
          onChange={(e) =>
            props.onDraft((r) => ({
              ...r,
              quality: e.currentTarget.value as GummyCinemaRecipe['quality'],
            }))
          }
        >
          <option value="auto">Auto</option>
          <option value="tablet">Tablet</option>
          <option value="high">High</option>
        </select>
      </GummyCinemaSection>
      <GummyCinemaSection
        title="Capture motion"
        {...props.sectionProps('motion')}
      >
        <GummyCinemaMotionControls
          motion={props.draft().shot.motion}
          mechanic={props.draft().shot.mechanic}
          onMotion={props.onMotion}
          onMechanic={props.onMechanic}
          advancedOpen={props.sections().shear}
          onAdvancedToggle={(open) => {
            props.sectionProps('shear').onToggle(open)
          }}
        />
      </GummyCinemaSection>
      <GummyCinemaSection
        title="Position and move"
        {...props.sectionProps('position')}
      >
        <p class={styles.help}>
          Independent composed positions. Use a FEN with both kings, then choose
          a legal capture onto an occupied square. Castling, en passant and
          promotion are outside this shot tool.
        </p>
        <label for="cinema-fen">Position (FEN)</label>
        <textarea
          id="cinema-fen"
          rows="4"
          value={props.draft().shot.fen}
          onInput={(e) => {
            props.onShot('fen', e.currentTarget.value)
          }}
        />
        <div class={styles.squares}>
          <label>
            From
            <input
              aria-label="Capture from square"
              maxLength="2"
              value={props.draft().shot.from}
              onInput={(e) => {
                props.onShot('from', e.currentTarget.value.toLowerCase())
              }}
            />
          </label>
          <label>
            To
            <input
              aria-label="Capture target square"
              maxLength="2"
              value={props.draft().shot.to}
              onInput={(e) => {
                props.onShot('to', e.currentTarget.value.toLowerCase())
              }}
            />
          </label>
        </div>
      </GummyCinemaSection>
      <p class={styles.help}>Edits take effect when you apply the shot.</p>
      <button
        type="button"
        class={`${styles.button} ${styles.apply}`}
        onClick={() => {
          props.onApply()
        }}
      >
        Apply shot settings
      </button>
    </fieldset>
  )
}
