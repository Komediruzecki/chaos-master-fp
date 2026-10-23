/** Static collection and board previews select appearance without allocating more GPU scenes. */
import { createSignal, For, Show } from 'solid-js'
import { FRACTAL_CHESS_COLLECTIONS } from '@/flame/chess/fractalChessCollections'
import { getFractalStudyGlassRole } from '@/flame/chess/fractalStudyGlass'
import { Check } from '@/icons'
import styles from './GummyMatchLookCards.module.css'
import type { NativeChessCollectionSelection } from './gummyMatchAppearance'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { GummyBoardTheme } from '@/components/GummyBoard/gummyBoardThemes'
import type { FractalChessCollectionId } from '@/flame/chess/fractalChessCollections'

type LookChoice<T extends string> = {
  id: T
  title: string
  detail: string
  image: string
  format?: 'svg'
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
const nativeCollections: readonly LookChoice<FractalChessCollectionId>[] =
  FRACTAL_CHESS_COLLECTIONS.map((collection) => ({
    id: collection.id,
    title: collection.name,
    detail: collection.description,
    image: `collection-native-${collection.id}`,
    format: 'svg',
  }))
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
            aria-label={`${choice.title} ${props.label === 'Boards' ? 'board' : 'collection'}`}
            aria-pressed={props.selected === choice.id}
            disabled={props.disabled}
            onClick={() => {
              props.onSelect(choice.id)
            }}
          >
            <span class={styles.image}>
              <img
                src={`/assets/chess/${choice.image}.${choice.format ?? 'webp'}`}
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
  nativeCollection?: NativeChessCollectionSelection
  onPalette: (palette: GummyPalette) => void
  onTheme: (theme: GummyBoardTheme) => void
  onNativeCollection: (
    selection: NativeChessCollectionSelection | undefined,
  ) => void
}) {
  const [lastNative, setLastNative] =
    createSignal<NativeChessCollectionSelection>(
      props.nativeCollection ?? {
        version: 1,
        id: 'wild-canopy',
        enclosure: 'pure',
      },
    )

  function chooseNative(selection: NativeChessCollectionSelection) {
    if (props.busy) return
    setLastNative(selection)
    props.onNativeCollection(selection)
  }
  return (
    <>
      <section class={styles.section} aria-labelledby="chess-collections-title">
        <h2 id="chess-collections-title">Your pieces</h2>
        <div class={styles.segmented} role="group" aria-label="Piece material">
          <button
            type="button"
            aria-pressed={!props.nativeCollection}
            disabled={props.busy}
            onClick={() => {
              props.onNativeCollection(undefined)
            }}
          >
            Gummy
          </button>
          <button
            type="button"
            aria-pressed={!!props.nativeCollection}
            disabled={props.busy}
            onClick={() => {
              chooseNative(lastNative())
            }}
          >
            Fractals
          </button>
        </div>
        <Show
          when={props.nativeCollection}
          fallback={
            <>
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
            </>
          }
        >
          {(native) => (
            <>
              <p>
                Six native flame shapes per collection. Matching roles share
                their geometry.
              </p>
              <LookCards
                choices={nativeCollections}
                label="Fractal collections"
                selected={native().id}
                disabled={props.busy}
                onSelect={(id) => {
                  chooseNative({ ...native(), id })
                }}
              />
              <div
                class={styles.segmented}
                role="group"
                aria-label="Fractal presentation"
              >
                <For each={['pure', 'glass'] as const}>
                  {(enclosure) => (
                    <button
                      type="button"
                      aria-pressed={native().enclosure === enclosure}
                      disabled={props.busy}
                      onClick={() => {
                        chooseNative({ ...native(), enclosure })
                      }}
                    >
                      {enclosure === 'pure' ? 'Pure fractals' : 'Glass study'}
                    </button>
                  )}
                </For>
              </div>
              <p class={styles.note}>
                Glass encloses this collection’s{' '}
                {getFractalStudyGlassRole(native().id)}. The other five roles
                stay pure. White and black use different palettes.
              </p>
              <a
                class={styles.previewLink}
                href={`/chess-collections?collection=${native().id}&enclosure=${native().enclosure}&view=board`}
              >
                Compare in the collection preview
              </a>
            </>
          )}
        </Show>
      </section>
      <Show
        when={!props.nativeCollection}
        fallback={
          <p class={styles.boardNote}>
            Fractal matches use the classic board. Your gummy board finish stays
            saved for when you switch back.
          </p>
        }
      >
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
      </Show>
    </>
  )
}
