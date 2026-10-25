/** Pawn-race board controls, native square picking and capture animation sequencing. */
import { batch, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { PawnBoardScene } from '@/components/PawnBoard/PawnBoardScene'
import { DEFAULT_PAWN_RECIPE } from '@/flame/chess/pawnFlame'
import { createPawnGame, legalPawnMoves, movePawn, selectPawn, squareName, } from '@/flame/chess/pawnGame'
import { readSavedPawnDesign } from '@/pages/Pawn/pawnDesignStorage'
import styles from './PawnBoardPage.module.css'
import type { PawnBoardForm } from '@/components/PawnBoard/PawnBoardScene'
import type { PawnSide } from '@/flame/chess/pawnFlame'
import type { PawnGameMode, PawnMoveReceipt, Square, } from '@/flame/chess/pawnGame'

const SIDE_NAMES: Record<PawnSide, string> = { light: 'Frost', dark: 'Ember' }
const FORM_NAMES: Record<PawnBoardForm, string> = {
  'blue-branch': 'Branching glass',
  lattice: 'Crystal lattice',
  echo: 'Glass echo',
}
const sameSquare = (a: Square, b: Square) =>
  a.file === b.file && a.rank === b.rank

export function PawnBoardPage() {
  const savedDesign = readSavedPawnDesign()
  const [form, setForm] = createSignal<PawnBoardForm>('blue-branch')
  const [inspection, setInspection] = createSignal(
    new URLSearchParams(window.location.search).get('view') === 'study',
  )
  const [inspectionSide, setInspectionSide] = createSignal<PawnSide>('light')
  const [showGlass, setShowGlass] = createSignal(true)
  const [game, setGame] = createSignal(createPawnGame())
  const [move, setMove] = createSignal<PawnMoveReceipt>()
  const [animating, setAnimating] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [resetViewKey, setResetViewKey] = createSignal(0)
  const [reducedMotion, setReducedMotion] = createSignal(false)
  const recipes = createMemo(() => {
    const selected = form()
    return selected === 'blue-branch'
      ? DEFAULT_PAWN_RECIPE
      : savedDesign.recipes[selected]
  })
  const lightRecipe = createMemo(() => ({
    ...recipes(),
    side: 'light' as const,
  }))
  const darkRecipe = createMemo(() => ({ ...recipes(), side: 'dark' as const }))
  const selectedPiece = createMemo(() =>
    game().pieces.find((piece) => piece.id === game().selectedId),
  )
  const choices = createMemo(() =>
    game().pieces.filter((piece) => piece.side === game().turn),
  )
  const legalMoves = createMemo(() =>
    game().selectedId ? legalPawnMoves(game(), game().selectedId!) : [],
  )
  const legalSquares = createMemo(() => legalMoves().map((choice) => choice.to))
  const selectedSquare = createMemo(() => selectedPiece()?.square)
  const locked = createMemo(
    () => inspection() || animating() || !ready() || !!game().winner,
  )
  const interactionHint = createMemo(() =>
    inspection()
      ? 'Drag to turn the pawn. Scroll or pinch to inspect its branching detail.'
      : 'Click a pawn, then a marked square. Drag to orbit. Scroll or pinch to zoom.',
  )
  const frostCount = createMemo(
    () => game().pieces.filter((piece) => piece.side === 'light').length,
  )
  const emberCount = createMemo(
    () => game().pieces.filter((piece) => piece.side === 'dark').length,
  )
  const status = createMemo(() => {
    const winner = game().winner
    if (winner) return `${SIDE_NAMES[winner]} wins`
    if (!ready()) return 'Building the board…'
    if (animating())
      return move()?.captured
        ? 'Shattering the captured pawn…'
        : 'Moving the pawn…'
    return `${SIDE_NAMES[game().turn]} to move`
  })
  const latestMove = createMemo(() => game().history.at(-1))
  const lastMoveText = createMemo(() => {
    const last = latestMove()
    if (!last) return 'No moves yet'
    return `${SIDE_NAMES[last.side]}: ${squareName(last.from)} to ${squareName(last.to)}${last.captured ? ' (capture)' : ''}`
  })
  const winnerReason = createMemo(() => {
    switch (game().winReason) {
      case 'finish':
        return 'A pawn reached the far rank.'
      case 'elimination':
        return 'All opposing pawns were captured.'
      case 'blocked':
        return 'The other side has no legal move.'
      default:
        return ''
    }
  })

  onMount(() => {
    const oldTitle = document.title
    document.title = 'Pawn Board · Lumen Apeiron'
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.append(robots)
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setReducedMotion(preference.matches)
    updatePreference()
    preference.addEventListener('change', updatePreference)
    onCleanup(() => {
      preference.removeEventListener('change', updatePreference)
      robots.remove()
      document.title = oldTitle
    })
  })

  function advance(to: Square) {
    if (locked()) return
    const id = game().selectedId
    if (!id) return
    const result = movePawn(game(), id, to)
    if (!result) return
    batch(() => {
      setAnimating(true)
      setMove(result.receipt)
      setGame(result.state)
    })
  }

  function pickSquare(square: Square) {
    if (locked()) return
    if (legalMoves().some((choice) => sameSquare(choice.to, square))) {
      advance(square)
      return
    }
    const piece = game().pieces.find((candidate) =>
      sameSquare(candidate.square, square),
    )
    setGame((current) =>
      selectPawn(current, piece?.side === current.turn ? piece.id : undefined),
    )
  }

  function startGame(mode: PawnGameMode) {
    if (animating()) return
    const next = createPawnGame(mode)
    batch(() => {
      setInspection(false)
      setMove(undefined)
      setGame(mode === 'capture-demo' ? selectPawn(next, 'light_3') : next)
    })
  }

  function finishAnimation() {
    batch(() => {
      setAnimating(false)
      setMove(undefined)
    })
  }

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <a class={styles.brand} href="/">
          Lumen Apeiron
        </a>
        <nav class={styles.headerLinks} aria-label="Fractal chess">
          <a class={styles.forgeLink} href="/pawn">
            Edit pawn shapes
          </a>
          <a class={styles.forgeLink} href="/figurines">
            Figurine studies
          </a>
        </nav>
      </header>
      <div class={styles.layout}>
        <section
          class={styles.stagePanel}
          aria-label="Pawn board"
          data-ready={ready()}
        >
          <div class={styles.stageHeader}>
            <span>{inspection() ? 'Pawn study / 02' : 'Pawn race / 02'}</span>
            <span>{FORM_NAMES[form()]}</span>
          </div>
          <div class={styles.viewTools}>
            <div
              class={styles.viewModes}
              role="group"
              aria-label="Viewing mode"
            >
              <button
                type="button"
                class={styles.button}
                aria-pressed={!inspection()}
                disabled={animating()}
                onClick={() => setInspection(false)}
              >
                Board
              </button>
              <button
                type="button"
                class={styles.button}
                aria-pressed={inspection()}
                disabled={animating()}
                onClick={() => setInspection(true)}
              >
                Inspect pawn
              </button>
            </div>
            <label class={styles.glassToggle}>
              <input
                type="checkbox"
                checked={showGlass()}
                onChange={(event) => setShowGlass(event.currentTarget.checked)}
              />
              Glass shell
            </label>
          </div>
          <PawnBoardScene
            class={styles.scene}
            game={game()}
            move={move()}
            form={form()}
            inspection={inspection()}
            inspectionSide={inspectionSide()}
            showGlass={showGlass()}
            lightRecipe={lightRecipe()}
            darkRecipe={darkRecipe()}
            selected={selectedSquare()}
            legalSquares={legalSquares()}
            onSquarePick={pickSquare}
            resetViewKey={resetViewKey()}
            reducedMotion={reducedMotion()}
            onReady={setReady}
            onAnimationComplete={finishAnimation}
          />
          <div class={styles.stageFooter}>
            <p>{interactionHint()}</p>
            <button
              type="button"
              class={styles.button}
              onClick={() => setResetViewKey((key) => key + 1)}
            >
              Reset view
            </button>
          </div>
        </section>

        <aside class={styles.controls} aria-labelledby="board-title">
          <p class={styles.eyebrow}>Fractal chess</p>
          <h1 id="board-title">Branches under glass.</h1>
          <p class={styles.description}>
            Follow the blue branches from root to crown. Turn one pawn in the
            light, look through its glass shell, then play both sides of the
            board.
          </p>

          <Show when={inspection()}>
            <fieldset class={styles.formField}>
              <legend>Inspect a side</legend>
              <div class={styles.formOptions}>
                <For each={['light', 'dark'] as const}>
                  {(side) => (
                    <label>
                      <input
                        type="radio"
                        name="inspection-side"
                        checked={inspectionSide() === side}
                        onChange={() => setInspectionSide(side)}
                      />
                      <span>{SIDE_NAMES[side]}</span>
                    </label>
                  )}
                </For>
              </div>
            </fieldset>
          </Show>
          <Show when={!inspection()}>
            <div
              class={styles.turnCard}
              data-side={game().winner ?? game().turn}
            >
              <p class={styles.turnStatus} role="status" aria-live="polite">
                {status()}
              </p>
              <Show when={game().winner}>
                <p class={styles.detail}>{winnerReason()}</p>
              </Show>
              <div class={styles.counts}>
                <span>
                  Frost <b>{frostCount()}</b>
                </span>
                <span>
                  Ember <b>{emberCount()}</b>
                </span>
              </div>
            </div>
          </Show>

          <fieldset class={styles.formField} disabled={animating()}>
            <legend>Pawn form</legend>
            <div class={styles.formOptions}>
              <For
                each={[
                  { id: 'blue-branch' as const, label: 'Branching glass' },
                  { id: 'lattice' as const, label: 'Crystal lattice' },
                  { id: 'echo' as const, label: 'Glass echo' },
                ]}
              >
                {(option) => (
                  <label>
                    <input
                      type="radio"
                      name="board-pawn-form"
                      value={option.id}
                      checked={form() === option.id}
                      onChange={() => setForm(option.id)}
                    />
                    <span>{option.label}</span>
                  </label>
                )}
              </For>
            </div>
            <p class={styles.detail}>
              {form() === 'blue-branch'
                ? 'Recursive roots, a branching stem and a crown of smaller fronds. Frost and Ember share the same structure.'
                : 'Uses this form’s saved shape from Pawn Forge.'}
            </p>
          </fieldset>

          <Show when={!inspection()}>
            <label class={styles.pawnPicker} for="board-pawn-select">
              Choose a pawn
              <select
                id="board-pawn-select"
                value={game().selectedId ?? ''}
                disabled={locked()}
                onChange={(event) =>
                  setGame((current) =>
                    selectPawn(current, event.currentTarget.value || undefined),
                  )
                }
              >
                <option value="">Select on the board</option>
                <For each={choices()}>
                  {(piece) => (
                    <option value={piece.id}>
                      {SIDE_NAMES[piece.side]} at {squareName(piece.square)}
                    </option>
                  )}
                </For>
              </select>
            </label>

            <div class={styles.moves} aria-label="Available moves">
              <Show
                when={selectedPiece()}
                fallback={
                  <p class={styles.detail}>Select a pawn to see its moves.</p>
                }
              >
                <p class={styles.movesTitle}>
                  From {selectedPiece() && squareName(selectedPiece()!.square)}
                </p>
                <Show
                  when={legalMoves().length > 0}
                  fallback={
                    <p class={styles.detail}>
                      This pawn is blocked. Choose another.
                    </p>
                  }
                >
                  <For each={legalMoves()}>
                    {(choice) => (
                      <button
                        type="button"
                        class={styles.button}
                        disabled={locked()}
                        onClick={() => {
                          advance(choice.to)
                        }}
                      >
                        {choice.captureId ? 'Capture on' : 'Move to'}{' '}
                        {squareName(choice.to)}
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </Show>

          <div class={styles.actions}>
            <button
              type="button"
              class={`${styles.button} ${styles.primaryButton}`}
              disabled={animating()}
              onClick={() => {
                startGame('capture-demo')
              }}
            >
              Capture demo
            </button>
            <button
              type="button"
              class={styles.button}
              disabled={animating()}
              onClick={() => {
                startGame('standard')
              }}
            >
              New game
            </button>
          </div>
          <p class={styles.lastMove} aria-live="polite">
            {lastMoveText()}
          </p>

          <details class={styles.rules}>
            <summary>How to play</summary>
            <p>
              Frost moves first. Pawns advance one square, or two on their first
              move if both squares are clear. Capture diagonally. En passant is
              available immediately after an adjacent pawn advances two squares.
            </p>
            <p>
              Reach the far rank, capture every opposing pawn, or leave the
              other side without a legal move to win. This pawn race has no
              kings or promotion.
            </p>
            <p>
              Captures break the glass into mesh shards and scatter the fractal
              points. Use Inspect pawn to see the structure up close.
            </p>
          </details>
        </aside>
      </div>
    </main>
  )
}
