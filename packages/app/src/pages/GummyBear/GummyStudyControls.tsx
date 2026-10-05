/** Shared material-study mould selection; changing shape preserves the current tuning. */
import { For } from 'solid-js'
import styles from './GummyBearPage.module.css'
import type { GummyParticleFixture } from '@/simulation/gummy/gummyParticleFixtures'

export const GUMMY_STUDY_LABELS: Record<GummyParticleFixture, string> = {
  bear: 'Bear',
  pawn: 'Pawn',
  rook: 'Rook',
  knight: 'Knight',
  bishop: 'Bishop',
  queen: 'Queen',
  king: 'King',
  blobs: 'Two blobs',
}

export function GummyStudyControls(props: {
  fixture: GummyParticleFixture
  disabled: boolean
  onSelect: (fixture: GummyParticleFixture) => void
}) {
  return (
    <fieldset class={styles.fieldset} disabled={props.disabled}>
      <legend>Shape</legend>
      <div class={styles.segments} role="group" aria-label="Particle study">
        <For
          each={
            [
              'bear',
              'pawn',
              'rook',
              'knight',
              'bishop',
              'queen',
              'king',
              'blobs',
            ] as const
          }
        >
          {(fixture) => (
            <button
              type="button"
              aria-pressed={props.fixture === fixture}
              onClick={() => {
                props.onSelect(fixture)
              }}
            >
              {GUMMY_STUDY_LABELS[fixture]}
            </button>
          )}
        </For>
      </div>
      <p class={styles.note}>
        {props.fixture === 'blobs'
          ? 'Two free blobs keep their amber and turquoise colours. Contact is experimental: nearby blobs can push apart before their surfaces touch.'
          : props.fixture === 'bear'
            ? 'Tune the bear, then try the same material on a chess piece. Changing shape resets the study and keeps your settings.'
            : 'Classic chess shapes, filled with coloured jelly. Grab the head or crown to test a preset. Changing shape keeps your settings.'}
      </p>
    </fieldset>
  )
}
