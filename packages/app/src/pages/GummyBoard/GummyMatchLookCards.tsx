/** Static collection and board previews select appearance without allocating more GPU scenes. */
import { For } from 'solid-js'
import { Check } from '@/icons'
import styles from './GummyMatchLookCards.module.css'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { GummyBoardTheme } from '@/components/GummyBoard/gummyBoardThemes'

type LookChoice<T extends string> = {
  id: T
  title: string
  detail: string
  image: string
}

const collections: readonly LookChoice<GummyPalette>[] = [
  {
    id: 'marble',
    title: 'Marble',
    detail: 'Amber, ruby and teal',
    image: 'collection-marble',
  },
  {
    id: 'lagoon',
    title: 'Lagoon',
    detail: 'Blue and green currents',
    image: 'collection-lagoon',
  },
  {
    id: 'candy',
    title: 'Candy',
    detail: 'Layered fruit colours',
    image: 'collection-candy',
  },
]
const boards: readonly LookChoice<GummyBoardTheme>[] = [
  {
    id: 'classic',
    title: 'Classic',
    detail: 'A warm studio board',
    image: 'board-classic',
  },
  {
    id: 'glass',
    title: 'Glass',
    detail: 'Clear surface, coloured light',
    image: 'board-glass',
  },
  {
    id: 'lava',
    title: 'Lava',
    detail: 'Dark stone, glowing seams',
    image: 'board-lava',
  },
]

function LookCards<T extends string>(props: {
  choices: readonly LookChoice<T>[]
  label: string
  selected: T
  disabled: boolean
  onSelect: (value: T) => void
}) {
  return (
    <div class={styles.cards} role="group" aria-label={props.label}>
      <For each={props.choices}>
        {(choice) => (
          <button
            type="button"
            class={styles.card}
            aria-label={`${choice.title} ${props.label === 'Piece collections' ? 'collection' : 'board'}`}
            aria-pressed={props.selected === choice.id}
            disabled={props.disabled}
            onClick={() => {
              props.onSelect(choice.id)
            }}
          >
            <span class={styles.image}>
              <img
                src={`/assets/chess/${choice.image}.webp`}
                alt=""
                loading="lazy"
                decoding="async"
                width="960"
                height="600"
              />
              <span class={styles.check} aria-hidden="true">
                <Check />
              </span>
            </span>
            <span class={styles.caption}>
              <strong>{choice.title}</strong>
              <span>{choice.detail}</span>
            </span>
          </button>
        )}
      </For>
    </div>
  )
}

export function GummyMatchLookCards(props: {
  palette: GummyPalette
  theme: GummyBoardTheme
  busy: boolean
  onPalette: (palette: GummyPalette) => void
  onTheme: (theme: GummyBoardTheme) => void
}) {
  return (
    <>
      <section class={styles.section} aria-labelledby="chess-collections-title">
        <h2 id="chess-collections-title">Your pieces</h2>
        <p>Six gummy shapes. Choose their colour collection.</p>
        <LookCards
          choices={collections}
          label="Piece collections"
          selected={props.palette}
          disabled={props.busy}
          onSelect={props.onPalette}
        />
        <p class={styles.note}>
          {props.palette === 'blue'
            ? 'The opposing side wears marble.'
            : 'The opposing side wears blue.'}{' '}
          Each side keeps its own colours.
        </p>
      </section>
      <section class={styles.section} aria-labelledby="chess-boards-title">
        <h2 id="chess-boards-title">The board</h2>
        <LookCards
          choices={boards}
          label="Boards"
          selected={props.theme}
          disabled={props.busy}
          onSelect={props.onTheme}
        />
      </section>
    </>
  )
}
