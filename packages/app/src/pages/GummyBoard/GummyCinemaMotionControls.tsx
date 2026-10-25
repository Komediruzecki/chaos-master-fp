/** Fixed capture mechanics and advanced explicit motion edits stay staged until the shot is applied. */
import { For, Show } from 'solid-js'
import { GUMMY_BOARD_EARLY_SHEAR_MOTION, GUMMY_BOARD_MOTION_RANGES, GUMMY_BOARD_ORIGINAL_MOTION, } from '@/components/GummyBoard/gummyBoardShots'
import { GUMMY_CAPTURE_MECHANICS } from '@/components/GummyBoard/gummyCaptureMechanics'
import motionStyles from './GummyCinemaMotionControls.module.css'
import styles from './GummyCinemaPage.module.css'
import { GummyCinemaSection } from './GummyCinemaSection'
import type { GummyBoardShotMotion } from '@/components/GummyBoard/gummyBoardShots'
import type { GummyCaptureMechanic, GummyCaptureMechanicId, } from '@/components/GummyBoard/gummyCaptureMechanics'

export function GummyCinemaMotionControls(props: {
  motion: GummyBoardShotMotion
  mechanic?: GummyCaptureMechanic
  onMotion: (motion: Readonly<GummyBoardShotMotion>) => void
  onMechanic: (id: GummyCaptureMechanicId) => void
  advancedOpen: boolean
  onAdvancedToggle: (open: boolean) => void
}) {
  const legacyMotion = () =>
    !props.mechanic &&
    (props.motion.twistAngle ?? 0) === 0 &&
    (props.motion.shearSign ?? 1) === 1
  return (
    <>
      <p class={styles.help}>
        Choose the contact motion for this shot. Apply the settings to replay it
        with the same material.
      </p>
      <div
        class={motionStyles.choices}
        role="group"
        aria-label="Capture mechanic"
      >
        <For each={GUMMY_CAPTURE_MECHANICS}>
          {(choice) => (
            <button
              class={motionStyles.choice}
              type="button"
              aria-label={choice.title}
              aria-pressed={props.mechanic?.id === choice.id}
              onClick={() => {
                props.onMechanic(choice.id)
              }}
            >
              <strong>{choice.title}</strong>
              <span>{choice.description}</span>
            </button>
          )}
        </For>
      </div>
      <p class={styles.help} aria-live="polite">
        <Show
          when={props.mechanic}
          fallback="Custom motion. The recipe keeps your exact settings."
        >
          {(mechanic) => (
            <>
              {
                GUMMY_CAPTURE_MECHANICS.find(
                  (item) => item.id === mechanic().id,
                )?.title
              }{' '}
              selected. The same motion is used for every replay.
            </>
          )}
        </Show>
      </p>
      <p id="cinema-shear-help" class={styles.help}>
        Press and peel pauses halfway down for a sideways sweep. Original motion
        sweeps after the full press. Apply the settings to replay your choice.
      </p>
      <div class={styles.playback} role="group" aria-label="Shot motion">
        <button
          class={styles.button}
          type="button"
          aria-pressed={
            legacyMotion() &&
            props.motion.shearOnset ===
              GUMMY_BOARD_ORIGINAL_MOTION.shearOnset &&
            props.motion.shearDistance ===
              GUMMY_BOARD_ORIGINAL_MOTION.shearDistance &&
            (props.motion.contactHold ?? 0) ===
              GUMMY_BOARD_ORIGINAL_MOTION.contactHold
          }
          onClick={() => {
            props.onMotion(GUMMY_BOARD_ORIGINAL_MOTION)
          }}
        >
          Original motion
        </button>
        <button
          class={styles.button}
          type="button"
          aria-pressed={
            legacyMotion() &&
            props.motion.shearOnset ===
              GUMMY_BOARD_EARLY_SHEAR_MOTION.shearOnset &&
            props.motion.shearDistance ===
              GUMMY_BOARD_EARLY_SHEAR_MOTION.shearDistance &&
            (props.motion.contactHold ?? 0) ===
              GUMMY_BOARD_EARLY_SHEAR_MOTION.contactHold
          }
          onClick={() => {
            props.onMotion(GUMMY_BOARD_EARLY_SHEAR_MOTION)
          }}
        >
          Press and peel
        </button>
      </div>
      <GummyCinemaSection
        title="Crush and shear"
        open={props.advancedOpen}
        onToggle={props.onAdvancedToggle}
        compact
      >
        <label for="cinema-shear-onset">
          Shear onset: {Math.round(props.motion.shearOnset * 100)}%
        </label>
        <input
          id="cinema-shear-onset"
          aria-describedby="cinema-shear-help"
          type="range"
          min={GUMMY_BOARD_MOTION_RANGES.shearOnset.min}
          max={GUMMY_BOARD_MOTION_RANGES.shearOnset.max}
          step="0.05"
          value={props.motion.shearOnset}
          onInput={(e) => {
            props.onMotion({
              ...props.motion,
              shearOnset: Number(e.currentTarget.value),
            })
          }}
        />
        <label for="cinema-shear-distance">
          Sideways travel: {props.motion.shearDistance.toFixed(2)}
        </label>
        <input
          id="cinema-shear-distance"
          type="range"
          min={GUMMY_BOARD_MOTION_RANGES.shearDistance.min}
          max={GUMMY_BOARD_MOTION_RANGES.shearDistance.max}
          step="0.02"
          value={props.motion.shearDistance}
          onInput={(e) => {
            props.onMotion({
              ...props.motion,
              shearDistance: Number(e.currentTarget.value),
            })
          }}
        />
        <label for="cinema-contact-hold">
          Mid-press hold: {(props.motion.contactHold ?? 0).toFixed(2)} s
        </label>
        <input
          id="cinema-contact-hold"
          type="range"
          min={GUMMY_BOARD_MOTION_RANGES.contactHold.min}
          max={GUMMY_BOARD_MOTION_RANGES.contactHold.max}
          step="0.05"
          value={props.motion.contactHold ?? 0}
          onInput={(e) => {
            props.onMotion({
              ...props.motion,
              contactHold: Number(e.currentTarget.value),
            })
          }}
        />
        <p class={styles.help}>
          Onset runs from the original press start (0%) to the original late
          sweep (100%). Travel scales with piece size. The hold pauses halfway
          down while sideways motion continues. Apply the settings to replay the
          motion.
        </p>
      </GummyCinemaSection>
    </>
  )
}
