/** Compare complete fractal chess collections on one board before promoting a playable set. */
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { FractalCollectionStage } from '@/components/FractalCollection/FractalCollectionStage'
import { useCollectionClouds } from '@/components/FractalCollection/useCollectionClouds'
import { createChessCandidate } from '@/flame/chess/chessCandidate'
import { saveChessCandidateHandoff } from '@/flame/chess/chessCandidateHandoff'
import { buildFractalChessFlame, FRACTAL_CHESS_COLLECTIONS, getFractalChessCollection, } from '@/flame/chess/fractalChessCollections'
import { CHESS_FORGE_PATH } from '@/routing/appPath'
import { downloadBlob } from '@/utils/blob'
import base from '../Pawn/PawnPage.module.css'
import ui from './ChessCollectionsPage.module.css'
import { CollectionGlassControls } from './CollectionGlassControls'
import { collectionPreviewSearch, readCollectionPreviewSearch, } from './collectionPreviewLocation'
import type { CollectionCamera, CollectionEnclosure, CollectionQuality, CollectionView, } from '@/components/FractalCollection/collectionStageLayout'
import type { ChessCandidateRole } from '@/flame/chess/chessCandidate'
import type { PawnSide } from '@/flame/chess/pawnFlame'

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1)

export function ChessCollectionsPage() {
  const initial = readCollectionPreviewSearch(
    window.location.search,
    FRACTAL_CHESS_COLLECTIONS.map((item) => item.id),
  )
  const [collectionId, setCollectionId] = createSignal(initial.collection)
  const [role, setRole] = createSignal<ChessCandidateRole>(initial.role)
  const [side, setSide] = createSignal<PawnSide>(initial.side)
  const [view, setView] = createSignal<CollectionView>(initial.view)
  const [camera, setCamera] = createSignal<CollectionCamera>(initial.camera)
  const [quality, setQuality] = createSignal<CollectionQuality>(initial.quality)
  const [variation, setVariation] = createSignal(initial.variation)
  const [enclosure, setEnclosure] = createSignal<CollectionEnclosure>(
    initial.enclosure,
  )
  const [resetKey, setResetKey] = createSignal(0)
  const [ready, setReady] = createSignal(false)
  const [notice, setNotice] = createSignal('')
  const collection = createMemo(() => getFractalChessCollection(collectionId()))
  const selected = createMemo(
    () => collection().pieces.find((piece) => piece.role === role())!,
  )
  const built = useCollectionClouds(collectionId, quality)
  const count = createMemo(() =>
    FRACTAL_CHESS_COLLECTIONS.reduce(
      (sum, item) => sum + item.pieces.length,
      0,
    ),
  )
  const status = createMemo(
    () =>
      built.error() ||
      (built.busy()
        ? 'Preparing the collection…'
        : ready()
          ? 'Ready to explore'
          : 'Preparing the view…'),
  )
  const selection = createMemo(() => ({
    collection: collectionId(),
    role: role(),
    side: side(),
    view: view(),
    camera: camera(),
    quality: quality(),
    variation: variation(),
    enclosure: enclosure(),
  }))
  createEffect(() => {
    const search = collectionPreviewSearch(selection(), window.location.search)
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search}${window.location.hash}`,
    )
  })

  onMount(() => {
    const previous = document.title
    document.title = 'Fractal chess collections · Lumen Apeiron'
    onCleanup(() => {
      document.title = previous
    })
  })

  function selectCollection(id: string) {
    if (id === collectionId()) return
    batch(() => {
      setCollectionId(id)
      setReady(false)
      setNotice('')
    })
  }

  async function copyLink() {
    try {
      await globalThis.navigator.clipboard.writeText(window.location.href)
      setNotice(
        'Preview link copied. It opens this collection, role and camera preset.',
      )
    } catch {
      setNotice(
        'The preview is saved in the address bar. Copy its address to share this selection.',
      )
    }
  }

  function download() {
    const flame = buildFractalChessFlame(collectionId(), role(), side())
    downloadBlob(
      new Blob([JSON.stringify(flame, null, 2)], { type: 'application/json' }),
      `${collectionId()}-${role()}-${side()}.json`,
    )
    setNotice(
      `Downloaded ${selected().name}. Open the JSON in the flame editor.`,
    )
  }

  function inspect() {
    try {
      const candidate = createChessCandidate(
        buildFractalChessFlame(collectionId(), role(), side()),
        selected().name,
      )
      candidate.role = role()
      candidate.placement.scale = 0.9
      saveChessCandidateHandoff(candidate)
      window.location.assign(CHESS_FORGE_PATH)
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : 'Could not open this piece in the inspector.',
      )
    }
  }

  return (
    <main class={`${base.page} ${ui.page}`}>
      <header class={base.header}>
        <a class={base.brand} href="/#arcade">
          Lumen Apeiron / Arcade
        </a>
        <a class={base.brand} href="/chess-forge">
          Piece inspector
        </a>
      </header>
      <div class={`${base.workshop} ${ui.workshop}`}>
        <section
          class={`${base.preview} ${ui.preview}`}
          aria-label="Fractal collection preview"
        >
          <div class={base.previewHeader}>
            <span class={base.eyebrow}>{collection().name}</span>
            <span class={base.scale}>
              {view() === 'board'
                ? '32 pieces'
                : view() === 'lineup'
                  ? enclosure() === 'both'
                    ? 'Six roles + glass study'
                    : 'Six roles'
                  : selected().name}
            </span>
          </div>
          <div class={ui.stage}>
            <FractalCollectionStage
              clouds={built.clouds()}
              collectionId={collectionId()}
              enclosure={enclosure()}
              view={view()}
              role={role()}
              side={side()}
              variation={variation()}
              camera={camera()}
              resetKey={resetKey()}
              onReady={setReady}
              onSelect={(nextRole, nextSide) => {
                batch(() => {
                  setRole(nextRole)
                  setSide(nextSide)
                })
              }}
            />
            <Show when={enclosure() === 'both' && view() !== 'solo'}>
              <div class={ui.comparisonLegend}>
                <span>{view() === 'board' ? 'a–d · Pure' : 'Pure'}</span>
                <span>{view() === 'board' ? 'e–h · Glass' : 'Glass'}</span>
              </div>
            </Show>
            <Show when={built.busy() || built.error()}>
              <div class={ui.stageNotice} role="status">
                <span>{built.error() || 'Growing the collection…'}</span>
              </div>
            </Show>
          </div>
          <div class={`${base.previewFooter} ${ui.previewFooter}`}>
            <Show
              when={view() === 'lineup'}
              fallback={<p>Drag to orbit. Pinch to zoom.</p>}
            >
              <div
                class={ui.roleStrip}
                aria-label="Look closer at a lineup role"
              >
                <For each={collection().pieces}>
                  {(piece) => (
                    <button
                      type="button"
                      aria-pressed={role() === piece.role}
                      aria-label={`Look closer at ${piece.role}: ${piece.name}`}
                      title={`${piece.name} · Look closer`}
                      onClick={() => {
                        batch(() => {
                          setRole(piece.role)
                          setView('solo')
                        })
                      }}
                    >
                      {titleCase(piece.role)}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <button
              class={base.quietButton}
              type="button"
              onClick={() => setResetKey((key) => key + 1)}
            >
              Reset view
            </button>
          </div>
          <div class={base.renderLine}>
            <span role="status">{status()}</span>
            <span>Shape study</span>
          </div>
        </section>
        <aside
          class={`${base.controls} ${ui.controls}`}
          aria-label="Collection controls"
        >
          <div class={`${base.intro} ${ui.intro}`}>
            <p class={base.eyebrow}>Fractal chess / Art studies</p>
            <h1>Choose a different kind of piece.</h1>
            <p class={base.description}>
              {count()} shapes, arranged in complete sets. Compare them
              together, then look closer at one.
            </p>
          </div>
          <CollectionGlassControls
            collectionId={collectionId()}
            role={role()}
            view={view()}
            enclosure={enclosure()}
            onEnclosure={setEnclosure}
            onStudy={(id, nextRole) => {
              batch(() => {
                selectCollection(id)
                setRole(nextRole)
              })
            }}
          />
          <fieldset class={ui.field}>
            <legend>Collection</legend>
            <div class={ui.collections}>
              <For each={FRACTAL_CHESS_COLLECTIONS}>
                {(item, index) => (
                  <button
                    type="button"
                    class={ui.collectionCard}
                    aria-pressed={collectionId() === item.id}
                    style={{ '--collection-accent': item.accent }}
                    onClick={() => {
                      selectCollection(item.id)
                    }}
                  >
                    <span class={ui.collectionNumber}>
                      {String(index() + 1).padStart(2, '0')}
                    </span>
                    <span class={ui.collectionCopy}>
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                      <small>Six shapes · two sides</small>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </fieldset>
          <fieldset class={ui.field}>
            <legend>View</legend>
            <div class={ui.segmented}>
              <For each={['board', 'lineup', 'solo'] as const}>
                {(mode) => (
                  <button
                    type="button"
                    aria-pressed={view() === mode}
                    onClick={() => setView(mode)}
                  >
                    {mode === 'board'
                      ? 'Full board'
                      : mode === 'lineup'
                        ? 'Lineup'
                        : 'One piece'}
                  </button>
                )}
              </For>
            </div>
          </fieldset>
          <fieldset class={ui.field}>
            <legend>Inspect a role</legend>
            <div class={ui.roles}>
              <For each={collection().pieces}>
                {(piece) => (
                  <button
                    type="button"
                    aria-pressed={role() === piece.role}
                    onClick={() => setRole(piece.role)}
                  >
                    <span>{titleCase(piece.role)}</span>
                    <small>{piece.name}</small>
                  </button>
                )}
              </For>
            </div>
          </fieldset>
          <article class={ui.selected}>
            <h2>{selected().name}</h2>
            <p>{selected().description}</p>
            <div class={ui.segmented} aria-label="Selected side">
              <For each={['light', 'dark'] as const}>
                {(item) => (
                  <button
                    type="button"
                    aria-pressed={side() === item}
                    onClick={() => setSide(item)}
                  >
                    {titleCase(item)} side
                  </button>
                )}
              </For>
            </div>
            <button
              class={base.secondaryButton}
              type="button"
              onClick={() => setView('solo')}
            >
              Look closer
            </button>
          </article>
          <details class={ui.section} open>
            <summary>Camera & colour</summary>
            <div class={ui.segmented}>
              <For each={['perspective', 'front', 'top'] as const}>
                {(item) => (
                  <button
                    type="button"
                    aria-pressed={camera() === item}
                    onClick={() => setCamera(item)}
                  >
                    {titleCase(item)}
                  </button>
                )}
              </For>
            </div>
            <label class={ui.toggle}>
              <input
                type="checkbox"
                checked={variation()}
                onChange={(event) => setVariation(event.currentTarget.checked)}
              />
              <span>Small colour differences between matching pieces</span>
            </label>
            <label class={base.selectField}>
              Preview detail
              <select
                aria-label="Preview detail"
                value={quality()}
                onChange={(event) =>
                  setQuality(event.currentTarget.value as CollectionQuality)
                }
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </label>
          </details>
          <div class={base.actions}>
            <a
              class={`${base.primaryButton} ${ui.playLink}`}
              href={`/gummy?view=match&collection=${collection().id}&enclosure=${enclosure() === 'pure' ? 'pure' : 'glass'}`}
            >
              {enclosure() === 'pure'
                ? 'Play this collection'
                : 'Play with glass'}
            </a>
            <button class={base.primaryButton} type="button" onClick={inspect}>
              Inspect this piece in Forge
            </button>
            <button
              class={base.secondaryButton}
              type="button"
              onClick={download}
            >
              Download native flame JSON
            </button>
            <button
              class={base.secondaryButton}
              type="button"
              onClick={() => {
                void copyLink()
              }}
            >
              Copy preview link
            </button>
          </div>
          <Show when={notice()}>
            <p class={ui.notice} role="status">
              {notice()}
            </p>
          </Show>
          <p class={base.note}>
            These are visual studies. Capture physics comes after choosing the
            shapes. Your existing gummy and fractal pieces are still available.
          </p>
          <a class={ui.previous} href="/figurines">
            Previous figurine studies
          </a>
        </aside>
      </div>
    </main>
  )
}
