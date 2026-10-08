/** Local legal chess with a reviewable move history and a capture handoff to the shot studio. */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { GummyMatchScene } from '@/components/GummyBoard/GummyMatchScene'
import { ChevronLeft, ChevronRight, Reset, SkipBack, SkipForward, Undo, } from '@/icons'
import styles from './GummyMatchPage.module.css'
import { GummyMatchResult } from './GummyMatchResult'
import { GummyMatchSidebar } from './GummyMatchSidebar'
import { useGummyMatch } from './useGummyMatch'
import type { ChessPosition } from '@chaos-master/core/chess/chessGame'

export function GummyMatchPage() {
  const match = useGummyMatch()
  const settings = () => match.appearance().settings
  const theme = () => match.appearance().theme
  const quality = () => match.appearance().quality
  const scale = () => match.appearance().scale
  const [ready, setReady] = createSignal(false)
  const [sceneError, setSceneError] = createSignal('')
  const [sceneKey, setSceneKey] = createSignal(1)
  const [dismissedResult, setDismissedResult] = createSignal<ChessPosition>()
  let resultButton: HTMLButtonElement | undefined
  let heading: HTMLHeadingElement | undefined
  const busy = createMemo(() => !!match.receipt())
  const unavailable = createMemo(() => busy() || !ready() || !!sceneError())
  const finished = createMemo(() => match.position().status !== 'active')
  const resultVisible = createMemo(
    () =>
      finished() && !unavailable() && dismissedResult() !== match.position(),
  )
  const side = createMemo(() =>
    match.position().turn === 'w' ? 'White' : 'Black',
  )
  const pieces = createMemo(() =>
    match
      .position()
      .pieces.filter((piece) => piece.color === match.position().turn),
  )
  const selected = createMemo(() =>
    match
      .position()
      .pieces.find((piece) => piece.square === match.selectedSquare()),
  )
  const status = createMemo(() => {
    const position = match.position()
    if (position.status === 'checkmate')
      return `${position.winner === 'w' ? 'White' : 'Black'} wins by checkmate`
    if (position.status === 'stalemate') return 'Draw by stalemate'
    if (position.status === 'draw') {
      const reasons: Record<string, string> = {
        'insufficient-material': 'insufficient material',
        'threefold-repetition': 'threefold repetition',
        'fivefold-repetition': 'fivefold repetition',
        'fifty-move': 'the fifty-move rule',
        'seventy-five-move': 'the seventy-five-move rule',
      }
      return `Draw${position.drawReason ? ` by ${reasons[position.drawReason] ?? position.drawReason}` : ''}`
    }
    return `${side()} to move${position.check ? ' · Check' : ''}`
  })
  const selectionHint = createMemo(() => {
    if (busy())
      return `Playing ${match.receipt()!.san}. Skip finishes on the same position.`
    if (match.promotion()) return 'Choose the piece your pawn becomes.'
    if (match.position().status !== 'active')
      return 'Review a move or start a new game.'
    const piece = selected()
    if (piece)
      return `${side()} ${piece.role} on ${piece.square}. Choose a highlighted square.`
    return `Tap a ${side().toLowerCase()} piece, then its destination. Drag the board to orbit.`
  })

  createEffect(() => {
    // Leaving the final position makes its result available when revisited.
    if (!finished()) setDismissedResult(undefined)
  })

  onMount(() => {
    const title = document.title
    document.title = 'Play gummy chess | Lumen Apeiron'
    onCleanup(() => {
      document.title = title
    })
  })

  function selectSquare(square: string) {
    if (!unavailable()) match.selectSquare(square)
  }

  function reviewResult() {
    setDismissedResult(match.position())
    resultButton?.focus({ preventScroll: true })
  }

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <a class={styles.brand} href="/">
          Lumen Apeiron
        </a>
        <nav aria-label="Gummy studies">
          <a href="/gummy?view=cinema">Shot studio</a>
          <a href="/gummy?view=board">Crash study</a>
          <a href="/gummy?experiment=mpm">Workbench</a>
        </nav>
      </header>
      <div class={styles.layout}>
        <section
          class={styles.board}
          aria-label="Playable gummy chess board"
          data-ready={ready()}
        >
          <div class={styles.boardHeader}>
            <div>
              <p class={styles.eyebrow}>Local two-player</p>
              <h1 ref={heading} tabIndex={-1}>
                Gummy chess
              </h1>
            </div>
            <p class={styles.turn} role="status" aria-live="polite">
              {status()}
            </p>
          </div>
          <div
            class={styles.canvasSlot}
            classList={{ [styles.resultOpen!]: resultVisible() }}
          >
            <Show when={sceneKey()} keyed>
              {(_key) => (
                <GummyMatchScene
                  position={match.position()}
                  receipt={match.receipt()}
                  selectedSquare={match.selectedSquare()}
                  legalSquares={match.legalSquares()}
                  settings={settings()}
                  quality={quality()}
                  scale={scale()}
                  theme={theme()}
                  onSquare={selectSquare}
                  onComplete={match.finishAnimation}
                  onReady={setReady}
                  onError={setSceneError}
                />
              )}
            </Show>
            <Show when={!ready() && !sceneError()}>
              <p class={styles.loading}>Preparing the board…</p>
            </Show>
            <Show when={resultVisible()}>
              <GummyMatchResult
                position={match.position()}
                explanation={status()}
                onReview={reviewResult}
                onNewGame={() => {
                  match.newGame()
                  heading?.focus({ preventScroll: true })
                }}
              />
            </Show>
          </div>
          <div class={styles.boardFooter}>
            <div class={styles.hintRow}>
              <p class={styles.hint} aria-live="polite">
                {selectionHint()}
              </p>
              <Show when={finished() && !resultVisible()}>
                <button
                  ref={resultButton}
                  class={styles.textButton}
                  type="button"
                  disabled={unavailable()}
                  onClick={() => {
                    setDismissedResult(undefined)
                  }}
                >
                  Show result
                </button>
              </Show>
            </div>
            <Show when={match.promotion()} keyed>
              {(moves) => (
                <div
                  class={styles.promotion}
                  role="group"
                  aria-label="Choose promotion"
                >
                  <For each={moves}>
                    {(move) => (
                      <button
                        type="button"
                        class={styles.button}
                        onClick={() => {
                          match.commit(move)
                        }}
                      >
                        {move.promotion![0]!.toUpperCase()}
                        {move.promotion!.slice(1)}
                      </button>
                    )}
                  </For>
                  <button
                    type="button"
                    class={styles.textButton}
                    onClick={match.clearSelection}
                  >
                    Cancel promotion
                  </button>
                </div>
              )}
            </Show>
            <div class={styles.playback}>
              <Show
                when={busy()}
                fallback={
                  <button
                    class={styles.button}
                    type="button"
                    disabled={!match.currentMove() || unavailable()}
                    onClick={match.replay}
                  >
                    <Reset aria-hidden="true" />
                    Replay move
                  </button>
                }
              >
                <button
                  class={styles.primary}
                  type="button"
                  onClick={() => {
                    match.finishAnimation()
                  }}
                >
                  <SkipForward aria-hidden="true" />
                  Skip animation
                </button>
              </Show>
              <button
                class={styles.button}
                type="button"
                disabled={busy() || match.cursor() === 0}
                onClick={match.undo}
                title="Remove this move and any later moves"
              >
                <Undo aria-hidden="true" />
                Undo move
              </button>
            </div>
            <div class={styles.timeline} role="group" aria-label="Review game">
              <button
                class={styles.iconButton}
                type="button"
                aria-label="Starting position"
                disabled={busy() || match.cursor() === 0}
                onClick={() => {
                  match.seek(0)
                }}
              >
                <SkipBack aria-hidden="true" />
              </button>
              <button
                class={styles.iconButton}
                type="button"
                aria-label="Previous move"
                disabled={busy() || match.cursor() === 0}
                onClick={() => {
                  match.seek(match.cursor() - 1)
                }}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <output class={styles.ply}>
                Move {match.cursor()} of {match.game().history.length}
              </output>
              <button
                class={styles.iconButton}
                type="button"
                aria-label="Next move"
                disabled={
                  busy() || match.cursor() === match.game().history.length
                }
                onClick={() => {
                  match.seek(match.cursor() + 1)
                }}
              >
                <ChevronRight aria-hidden="true" />
              </button>
              <button
                class={styles.iconButton}
                type="button"
                aria-label="Latest position"
                disabled={
                  busy() || match.cursor() === match.game().history.length
                }
                onClick={() => {
                  match.seek(match.game().history.length)
                }}
              >
                <SkipForward aria-hidden="true" />
              </button>
            </div>
            <Show when={match.reviewing()}>
              <p class={styles.help}>
                Reviewing an earlier position. Playing a move here replaces the
                later moves.
              </p>
            </Show>
            <Show when={sceneError()}>
              <div class={styles.error} role="alert">
                <p>{sceneError()}</p>
                <button
                  class={styles.button}
                  type="button"
                  disabled={busy()}
                  onClick={() => {
                    setSceneError('')
                    setReady(false)
                    setSceneKey((value) => value + 1)
                  }}
                >
                  Reload board
                </button>
              </div>
            </Show>
            <details class={styles.keyboardPanel}>
              <summary>Move by square</summary>
              <label class={styles.label} for="match-piece">
                Piece to move
              </label>
              <select
                id="match-piece"
                class={styles.select}
                disabled={
                  unavailable() ||
                  !!match.promotion() ||
                  match.position().status !== 'active'
                }
                value={match.selectedSquare() ?? ''}
                onChange={(event) => {
                  selectSquare(event.currentTarget.value)
                }}
              >
                <option value="">Choose a {side().toLowerCase()} piece</option>
                <For each={pieces()}>
                  {(piece) => (
                    <option value={piece.square}>
                      {piece.role[0]!.toUpperCase()}
                      {piece.role.slice(1)} · {piece.square}
                    </option>
                  )}
                </For>
              </select>
              <div
                class={styles.destinations}
                role="group"
                aria-label="Legal destinations"
              >
                <For each={match.legalSquares()}>
                  {(square) => (
                    <button
                      class={styles.button}
                      type="button"
                      disabled={unavailable() || !!match.promotion()}
                      onClick={() => {
                        selectSquare(square)
                      }}
                    >
                      {square}
                    </button>
                  )}
                </For>
              </div>
              <Show when={selected() && match.legalSquares().length === 0}>
                <p class={styles.help}>
                  This piece has no legal move. Choose another piece.
                </p>
              </Show>
            </details>
          </div>
        </section>
        <GummyMatchSidebar match={match} busy={busy()} />
      </div>
    </main>
  )
}
