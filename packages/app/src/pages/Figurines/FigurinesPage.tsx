/** Native flame and geometric figurine collections in one live stage without draft writes. */
import { batch, createMemo, createSignal, For, onCleanup, onMount, } from 'solid-js'
import { PawnStage } from '@/components/PawnStage/PawnStage'
import { buildFigurine, FIGURINE_COLLECTIONS, getFigurineCollection, } from '@/flame/chess/figurineCollections'
import { downloadBlob } from '@/utils/blob'
import ui from '../Pawn/PawnPage.module.css'
import styles from './FigurinesPage.module.css'
import type { PawnRenderStatus } from '@/components/PawnStage/PawnStage'
import type { FigurineCollectionId, FigurineId, } from '@/flame/chess/figurineCollections'
import type { PawnSide } from '@/flame/chess/pawnFlame'

export function FigurinesPage() {
  const [collectionId, setCollectionId] =
    createSignal<FigurineCollectionId>('flame-experiments')
  const [selections, setSelections] = createSignal<
    Record<FigurineCollectionId, FigurineId>
  >({
    'flame-experiments': 'aurora-queen',
    'geometric-studies': 'lattice-pawn',
    'glass-cores': 'blue-branch-pawn',
  })
  const [sides, setSides] = createSignal<
    Record<FigurineCollectionId, PawnSide>
  >({
    'flame-experiments': 'light',
    'geometric-studies': 'light',
    'glass-cores': 'light',
  })
  const collection = createMemo(() => getFigurineCollection(collectionId()))
  const selectedId = createMemo(() => selections()[collectionId()])
  const side = createMemo(() => sides()[collectionId()])
  const paletteName = createMemo(
    () => collection().palettes.find((palette) => palette.id === side())!.name,
  )
  const [resetViewKey, setResetViewKey] = createSignal(0)
  const [renderStatus, setRenderStatus] = createSignal<PawnRenderStatus>({
    pointCount: 0,
    progress: 0,
    ready: false,
  })
  const study = createMemo(
    () => collection().figurines.find((item) => item.id === selectedId())!,
  )
  const flame = createMemo(() => buildFigurine(selectedId(), side()))
  const sampleLabel = createMemo(() => {
    const count = renderStatus().pointCount
    return count >= 1_000_000
      ? `${(count / 1_000_000).toFixed(1)}M samples`
      : `${Math.round(count / 1000)}K samples`
  })
  const stageLabel = createMemo(
    () => `Interactive ${study().name.toLowerCase()} fractal study`,
  )

  onMount(() => {
    const oldTitle = document.title
    document.title = 'Figurine studies · Lumen Apeiron'
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.append(robots)
    onCleanup(() => {
      robots.remove()
      document.title = oldTitle
    })
  })

  function selectCollection(id: FigurineCollectionId) {
    batch(() => {
      setCollectionId(id)
      setResetViewKey((key) => key + 1)
    })
  }

  function selectStudy(id: FigurineId) {
    batch(() => {
      setSelections((current) => ({ ...current, [collectionId()]: id }))
      setResetViewKey((key) => key + 1)
    })
  }

  function selectPalette(side: PawnSide) {
    setSides((current) => ({ ...current, [collectionId()]: side }))
  }

  function downloadStudy() {
    const payload = {
      format: 'lumen-fractal-figurine-study',
      version: 1,
      studyId: selectedId(),
      side: side(),
      flame: flame(),
    }
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      }),
      `fractal-${selectedId()}-${side()}.json`,
    )
  }

  return (
    <main class={ui.page}>
      <header class={ui.header}>
        <a class={ui.brand} href="/">
          Lumen Apeiron
        </a>
        <nav class={styles.navigation} aria-label="Fractal chess">
          <a class={ui.brand} href="/pawn">
            Pawn Forge
          </a>
          <a class={ui.brand} href="/chess">
            Pawn board
          </a>
        </nav>
      </header>
      <div class={ui.workshop}>
        <section class={ui.preview} aria-label="Selected figurine study">
          <div class={`${ui.previewHeader} ${styles.previewHeader}`}>
            <span class={ui.chapter}>{study().piece} study</span>
            <span class={ui.scale}>
              {paletteName()} /{' '}
              {collectionId() === 'geometric-studies' ? '1.8 m' : 'Human scale'}
            </span>
          </div>
          <PawnStage
            flame={flame()}
            resetViewKey={resetViewKey()}
            ariaLabel={stageLabel()}
            onStatusChange={setRenderStatus}
          />
          <div class={ui.previewFooter}>
            <p>Drag to orbit. Scroll or pinch to zoom.</p>
            <button
              type="button"
              class={ui.quietButton}
              onClick={() => setResetViewKey((key) => key + 1)}
            >
              Reset view
            </button>
          </div>
          <div class={ui.renderLine}>
            <span role="status" aria-live="polite">
              {renderStatus().ready
                ? 'Preview settled'
                : 'Growing the structure'}
            </span>
            <span>{sampleLabel()}</span>
          </div>
        </section>
        <section class={ui.controls} aria-labelledby="figurines-title">
          <div class={ui.intro}>
            <p class={ui.eyebrow}>Fractal chess</p>
            <h1 id="figurines-title">Figurine studies.</h1>
            <p class={ui.description}>{collection().description}</p>
          </div>
          <fieldset class={ui.sideField}>
            <legend>Choose a collection</legend>
            <div class={ui.sideOptions}>
              <For each={FIGURINE_COLLECTIONS}>
                {(item) => (
                  <label class={ui.sideOption}>
                    <input
                      type="radio"
                      name="figurine-collection"
                      value={item.id}
                      checked={collectionId() === item.id}
                      onChange={() => {
                        selectCollection(item.id)
                      }}
                    />
                    <span class={styles.collectionLabel}>{item.name}</span>
                  </label>
                )}
              </For>
            </div>
          </fieldset>
          <fieldset class={ui.formField}>
            <legend>Choose a study</legend>
            <div class={ui.formOptions}>
              <For each={collection().figurines}>
                {(item) => (
                  <label class={ui.formOption}>
                    <input
                      type="radio"
                      name="figurine-study"
                      aria-label={item.name}
                      value={item.id}
                      checked={selectedId() === item.id}
                      onChange={() => {
                        selectStudy(item.id)
                      }}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.family}</small>
                    </span>
                  </label>
                )}
              </For>
            </div>
          </fieldset>
          <fieldset class={ui.sideField}>
            <legend>{collection().paletteLegend}</legend>
            <div class={ui.sideOptions}>
              <For each={collection().palettes}>
                {(item) => (
                  <label class={ui.sideOption}>
                    <input
                      type="radio"
                      name="figurine-side"
                      value={item.id}
                      checked={side() === item.id}
                      onChange={() => {
                        selectPalette(item.id)
                      }}
                    />
                    <span>{item.name}</span>
                  </label>
                )}
              </For>
            </div>
          </fieldset>
          <article class={styles.details} aria-labelledby="study-title">
            <h2 id="study-title">{study().name}</h2>
            <p>{study().description}</p>
            <h3>Break pattern to explore</h3>
            <p>{study().fractureHint}</p>
          </article>
          <div class={ui.actions}>
            <button
              type="button"
              class={ui.primaryButton}
              onClick={downloadStudy}
            >
              Download native JSON
            </button>
            <a class={ui.boardLink} href="/pawn">
              Edit the fractal pawn
            </a>
          </div>
          <p class={ui.note}>
            These are shape studies. The board still plays pawns. Each download
            opens as a native 3D flame in the editor.
          </p>
        </section>
      </div>
    </main>
  )
}
