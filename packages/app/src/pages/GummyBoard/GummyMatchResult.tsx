/** Board-scoped game result with keyboard dismissal and an explicit return to review. */
import { createMemo, createUniqueId, onMount } from 'solid-js'
import { createBackLayer } from '@/lib/backStack'
import styles from './GummyMatchPage.module.css'
import type { ChessPosition } from '@chaos-master/core/chess/chessGame'

export function GummyMatchResult(props: {
  position: ChessPosition
  explanation: string
  onReview: () => void
  onNewGame: () => void
}) {
  const titleId = createUniqueId()
  const descriptionId = createUniqueId()
  const checkmate = createMemo(() => props.position.status === 'checkmate')
  const winner = createMemo(() =>
    props.position.winner === 'w' ? 'White' : 'Black',
  )
  const score = createMemo(() =>
    checkmate() ? (props.position.winner === 'w' ? '1–0' : '0–1') : '½–½',
  )
  let reviewButton: HTMLButtonElement | undefined
  createBackLayer(
    () => true,
    () => {
      props.onReview()
    },
    'chess-result',
  )

  onMount(() => reviewButton?.focus({ preventScroll: true }))

  return (
    <div class={styles.resultOverlay}>
      <section
        class={styles.resultCard}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          props.onReview()
        }}
      >
        <p class={styles.resultKicker}>
          {checkmate()
            ? 'Checkmate'
            : props.position.status === 'stalemate'
              ? 'Stalemate'
              : 'Game drawn'}
        </p>
        <h2 id={titleId}>{checkmate() ? `${winner()} wins` : 'Draw'}</h2>
        <p class={styles.resultScore} aria-hidden="true">
          {score()}
        </p>
        <p id={descriptionId} class={styles.resultDescription}>
          {checkmate()
            ? `${props.position.winner === 'w' ? 'Black' : 'White'} has no legal escape.`
            : `${props.explanation}.`}
        </p>
        <div class={styles.twoActions}>
          <button
            ref={reviewButton}
            class={styles.button}
            type="button"
            onClick={props.onReview}
          >
            Review board
          </button>
          <button
            class={styles.primary}
            type="button"
            onClick={props.onNewGame}
          >
            New game
          </button>
        </div>
      </section>
    </div>
  )
}
