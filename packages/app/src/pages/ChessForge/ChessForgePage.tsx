/** Native editor snapshots can be fitted and saved without claiming a verified solid. */
import { createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { BOARD_TILE_SIZE } from '@/components/PawnBoard/pawnBoardMath'
import { PawnStage } from '@/components/PawnStage/PawnStage'
import { CHESS_CANDIDATE_ROLES } from '@/flame/chess/chessCandidate'
import { getChessEditorReturnUrl } from '@/flame/chess/chessEditorReturn'
import { FIGURINE_STUDIES } from '@/flame/chess/figurineStudies'
import { tryValidateFlame } from '@/flame/schema/flameSchema'
import styles from '../Pawn/PawnPage.module.css'
import { CandidatePlacementControls } from './CandidatePlacementControls'
import ui from './ChessForgePage.module.css'
import { useChessCandidate } from './useChessCandidate'
import type { PawnRenderStatus } from '@/components/PawnStage/PawnStage'
import type { ChessCandidateRole } from '@/flame/chess/chessCandidate'
import type { FigurineStudyId } from '@/flame/chess/figurineStudies'
import type { Camera3DObj } from '@/flame/schema/flameSchema'

const INSPECTION_CAMERA: Camera3DObj = {
  theta: 0.4,
  phi: 1.25,
  radius: 4.5,
  target: [0, 0.9, 0],
  fov: 45,
  roll: 0,
}
const FIT_GUIDE = { squareSize: BOARD_TILE_SIZE, height: 1.8 }

export function ChessForgePage() {
  const forge = useChessCandidate()
  const editorReturnUrl = getChessEditorReturnUrl()
  let importInput: HTMLInputElement | undefined
  const [status, setStatus] = createSignal<PawnRenderStatus>({
    pointCount: 0,
    progress: 0,
    ready: false,
  })
  const is3D = createMemo(
    () => forge.candidate()?.source.flame.renderSettings.dimensions === 3,
  )
  const fitted = createMemo(() => is3D() && forge.view() === 'fit')
  const camera = createMemo(() => (fitted() ? INSPECTION_CAMERA : undefined))
  const guide = createMemo(() => (fitted() ? FIT_GUIDE : undefined))
  const blend = createMemo(() => {
    const stored = forge.flame()?.renderSettings.blendFlame
    return stored === undefined
      ? undefined
      : tryValidateFlame(structuredClone(stored))
  })
  const blendWeight = createMemo(
    () => forge.flame()?.renderSettings.blendWeight ?? 0,
  )
  const hasStoredBlend = createMemo(
    () =>
      forge.candidate()?.source.flame.renderSettings.blendFlame !== undefined,
  )
  const hasLayers = createMemo(
    () => (forge.candidate()?.source.flame.layers?.length ?? 0) > 0,
  )
  const statusLabel = createMemo(() =>
    forge.sourceError()
      ? 'Preview unavailable'
      : !forge.flame()
        ? 'Choose a source'
        : status().ready
          ? 'Preview settled'
          : 'Rendering source…',
  )
  const sampleLabel = createMemo(
    () => `${Math.round(status().pointCount / 1000).toLocaleString()}K samples`,
  )

  onMount(() => {
    const title = document.title
    document.title = 'Chess piece inspector · Lumen Apeiron'
    onCleanup(() => {
      document.title = title
    })
  })

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <a
          href={editorReturnUrl}
          class={styles.brand}
          onClick={(event) => {
            if (!forge.saveDraftBeforeLeaving()) event.preventDefault()
          }}
        >
          Back to editor
        </a>
        <span class={styles.chapter}>Fractal chess / Inspector</span>
      </header>
      <div class={styles.workshop}>
        <section class={styles.preview} aria-label="Chess candidate preview">
          <div class={styles.previewHeader}>
            <span class={styles.eyebrow}>
              {forge.candidate()?.name || 'Your next piece'}
            </span>
            <span class={styles.scale}>
              {fitted() ? 'Inspection fit' : 'Fractal source'}
            </span>
          </div>
          <Show
            when={forge.flame()}
            fallback={
              <div class={ui.empty}>
                <strong>
                  {forge.sourceError()
                    ? 'Could not render this source.'
                    : forge.candidate()
                      ? 'Loading source…'
                      : 'Start with a fractal.'}
                </strong>
                <p>
                  {forge.sourceError() ||
                    (forge.candidate()
                      ? 'Preparing its saved formulas.'
                      : 'Choose a study, open a saved candidate, or use Inspect for chess in the editor’s More menu.')}
                </p>
              </div>
            }
          >
            {(flame) => (
              <PawnStage
                flame={flame()}
                camera3D={camera()}
                fitGuide={guide()}
                blendFlame={blend()}
                blendWeight={blendWeight()}
                resetViewKey={forge.resetKey()}
                ariaLabel="Interactive chess candidate"
                onStatusChange={setStatus}
              />
            )}
          </Show>
          <div class={styles.previewFooter}>
            <p>
              {is3D()
                ? 'Drag to orbit. Pinch to zoom.'
                : 'Drag to pan. Pinch to zoom.'}
            </p>
            <button
              type="button"
              class={styles.quietButton}
              onClick={forge.resetView}
            >
              Reset view
            </button>
          </div>
          <div class={styles.renderLine}>
            <span>{statusLabel()}</span>
            <span>{forge.flame() ? sampleLabel() : ''}</span>
          </div>
        </section>
        <section class={styles.controls} aria-labelledby="candidate-title">
          <div class={styles.intro}>
            <p class={styles.eyebrow}>Chess piece inspector</p>
            <h1 id="candidate-title">Give your fractal a role.</h1>
            <p class={styles.description}>
              Explore its silhouette and fit before making a playable piece.
              Your source and custom formulas travel together in an independent
              copy.
            </p>
          </div>
          <Show when={forge.notice()}>
            <p role="status" class={ui.notice}>
              {forge.notice()}
            </p>
          </Show>
          <Show when={forge.pending()}>
            {(next) => (
              <div
                class={ui.notice}
                role="group"
                aria-label="Replace inspection draft"
              >
                <strong>Open {next().name}?</strong>
                <p>Your current draft has changes outside the saved library.</p>
                <div class={ui.confirmActions}>
                  <button
                    type="button"
                    class={styles.primaryButton}
                    onClick={() => {
                      forge.replace(true)
                    }}
                  >
                    Save & open
                  </button>
                  <button
                    type="button"
                    class={styles.secondaryButton}
                    onClick={() => {
                      forge.replace(false)
                    }}
                  >
                    Replace draft
                  </button>
                  <button
                    type="button"
                    class={styles.quietButton}
                    onClick={forge.cancelReplace}
                  >
                    Keep editing
                  </button>
                </div>
              </div>
            )}
          </Show>
          <details open class={ui.section}>
            <summary>Source & library</summary>
            <label class={styles.selectField}>
              Start from a study
              <select
                aria-label="Start from a study"
                value=""
                onChange={(event) => {
                  if (event.currentTarget.value)
                    forge.study(event.currentTarget.value as FigurineStudyId)
                  event.currentTarget.value = ''
                }}
              >
                <option value="">Choose a fractal study…</option>
                <For each={FIGURINE_STUDIES}>
                  {(study) => <option value={study.id}>{study.name}</option>}
                </For>
              </select>
            </label>
            <Show when={forge.saved().length > 0}>
              <label class={styles.selectField}>
                Saved candidates
                <select
                  aria-label="Saved candidates"
                  value=""
                  onChange={(event) => {
                    const selected = forge
                      .saved()
                      .find((item) => item.id === event.currentTarget.value)
                    if (selected) forge.select(structuredClone(selected))
                    event.currentTarget.value = ''
                  }}
                >
                  <option value="">Open a saved candidate…</option>
                  <For each={forge.saved()}>
                    {(item) => (
                      <option value={item.id}>
                        {item.name} · {item.role}
                      </option>
                    )}
                  </For>
                </select>
              </label>
            </Show>
            <input
              ref={importInput}
              hidden
              type="file"
              accept=".json,application/json"
              aria-label="Candidate file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void forge.importFile(file)
                event.currentTarget.value = ''
              }}
            />
            <button
              type="button"
              class={styles.secondaryButton}
              onClick={() => importInput?.click()}
            >
              Import candidate
            </button>
          </details>
          <Show when={forge.candidate()}>
            {(candidate) => (
              <>
                <label class={ui.textField}>
                  Candidate name
                  <input
                    aria-label="Candidate name"
                    type="text"
                    maxlength="64"
                    value={candidate().name}
                    onInput={(event) => {
                      forge.update({ name: event.currentTarget.value })
                    }}
                  />
                </label>
                <label class={styles.selectField}>
                  Chess role
                  <select
                    aria-label="Chess role"
                    value={candidate().role}
                    onChange={(event) => {
                      forge.update({
                        role: event.currentTarget.value as ChessCandidateRole,
                      })
                    }}
                  >
                    <For each={CHESS_CANDIDATE_ROLES}>
                      {(role) => (
                        <option value={role}>
                          {role.charAt(0).toUpperCase() + role.slice(1)}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                <Show
                  when={is3D()}
                  fallback={
                    <p class={ui.notice}>
                      This source is 2D. Inspect its artwork here; a 3D piece
                      needs a separate volume design.
                    </p>
                  }
                >
                  <fieldset class={ui.viewField}>
                    <legend>Preview</legend>
                    <div class={styles.sideOptions}>
                      <For each={['source', 'fit'] as const}>
                        {(view) => (
                          <label class={styles.sideOption}>
                            <input
                              type="radio"
                              name="candidate-view"
                              checked={forge.view() === view}
                              onChange={() => {
                                forge.setView(view)
                                forge.resetView()
                              }}
                            />
                            <span>
                              {view === 'source'
                                ? 'Fractal source'
                                : 'Inspection fit'}
                            </span>
                          </label>
                        )}
                      </For>
                    </div>
                  </fieldset>
                  <details open class={ui.section}>
                    <summary>Orientation & fit</summary>
                    <p class={styles.note}>
                      The guide marks one board square and a 1.8-unit pawn
                      height. Adjust the fit, then orbit to check the
                      silhouette.
                    </p>
                    <Show when={forge.view() === 'source'}>
                      <p class={ui.notice}>
                        Switch to Inspection fit to see these adjustments.
                      </p>
                    </Show>
                    <CandidatePlacementControls
                      placement={candidate().placement}
                      onChange={(placement) => {
                        forge.update({ placement })
                      }}
                    />
                  </details>
                </Show>
                <details class={ui.section}>
                  <summary>Source details</summary>
                  <p class={styles.note}>
                    {Object.keys(candidate().source.flame.transforms).length}{' '}
                    transforms · {candidate().source.customVariations.length}{' '}
                    custom formulas · {is3D() ? '3D' : '2D'} source
                  </p>
                  <p class={styles.note}>
                    The snapshot keeps the original maps, palette, camera and
                    stored blend. Inspection freezes the source; it does not
                    play an editor timeline.
                  </p>
                  <Show when={hasLayers()}>
                    <p class={ui.notice}>
                      Layer definitions are retained in the file. Layer
                      composition is not shown in this preview.
                    </p>
                  </Show>
                  <Show when={hasStoredBlend()}>
                    <p class={ui.notice}>
                      The preview supports one 2D blend. 3D and nested blends
                      are retained in the file but are not shown here.
                    </p>
                  </Show>
                </details>
                <div class={ui.readiness}>
                  <strong>Before solid conversion</strong>
                  <p>
                    Solid conversion comes next. This guide does not measure
                    bounds, connected volume or a stable base. Candidates stay
                    out of playable sets until those checks pass.
                  </p>
                </div>
                <div class={styles.actions}>
                  <button
                    type="button"
                    class={styles.primaryButton}
                    onClick={forge.save}
                  >
                    Save candidate
                  </button>
                  <button
                    type="button"
                    class={styles.secondaryButton}
                    onClick={forge.download}
                  >
                    Download candidate
                  </button>
                  <Show
                    when={forge
                      .saved()
                      .some((item) => item.id === candidate().id)}
                  >
                    <button
                      type="button"
                      class={styles.quietButton}
                      onClick={forge.remove}
                    >
                      Remove saved copy
                    </button>
                  </Show>
                  <a
                    href="/pawn?chessPawn=crown"
                    class={styles.boardLink}
                    onClick={(event) => {
                      if (!forge.saveDraftBeforeLeaving())
                        event.preventDefault()
                    }}
                  >
                    Open playable Pawn Forge
                  </a>
                </div>
                <p class={styles.note} role="status">
                  {forge.draftStatus()}
                </p>
              </>
            )}
          </Show>
        </section>
      </div>
    </main>
  )
}
