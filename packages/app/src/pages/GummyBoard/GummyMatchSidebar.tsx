/** Move history, PGN exchange and validated capture handoff for a local match. */
import { exportChessPgn } from '@chaos-master/core/chess/chessGame'
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { Copy, Film } from '@/icons'
import { GummyMatchAppearanceControls } from './GummyMatchAppearanceControls'
import styles from './GummyMatchPage.module.css'
import { createGummyMatchCinemaRecipe, gummyMatchCinemaReason, saveGummyMatchCinemaRecipe, } from './gummyMatchSession'
import type { useGummyMatch } from './useGummyMatch'

export function GummyMatchSidebar(props: {
  match: ReturnType<typeof useGummyMatch>
  busy: boolean
  onClose: () => void
  hidden: boolean
}) {
  const [tab, setTab] = createSignal<'look' | 'game'>('look')
  const [pgn, setPgn] = createSignal('')
  const [pgnStatus, setPgnStatus] = createSignal('')
  const [handoffError, setHandoffError] = createSignal('')
  const [copied, setCopied] = createSignal(false)
  const [copying, setCopying] = createSignal(false)
  const [pgnOpen, setPgnOpen] = createSignal(false)
  let pgnInput: HTMLTextAreaElement | undefined
  let railScroll: HTMLDivElement | undefined
  let disposed = false
  const cinemaReason = createMemo(() =>
    gummyMatchCinemaReason(props.match.currentMove()),
  )
  const historyRows = createMemo(() => {
    const rows: { number: number; white?: number; black?: number }[] = []
    props.match.game().history.forEach((move, index) => {
      const number = Number(move.before.fen.split(' ')[5])
      let row = rows[rows.length - 1]
      if (!row || row.number !== number) {
        row = { number }
        rows.push(row)
      }
      if (move.before.turn === 'w') row.white = index
      else row.black = index
    })
    return rows
  })

  onCleanup(() => {
    disposed = true
  })

  function selectTab(next: 'look' | 'game') {
    setTab(next)
    if (railScroll) railScroll.scrollTop = 0
  }

  function importPgn() {
    if (props.match.importPgn(pgn())) {
      setPgnStatus(
        `Imported ${props.match.game().history.length} moves. Step through the game below the board.`,
      )
      setCopied(false)
      setHandoffError('')
    } else setPgnStatus('')
  }

  async function copyPgn() {
    const text = exportChessPgn(props.match.game(), props.match.headers())
    setPgn(text)
    setCopying(true)
    setCopied(false)
    try {
      await globalThis.navigator.clipboard.writeText(text)
      if (!disposed) {
        setCopied(true)
        setPgnStatus('PGN copied.')
      }
    } catch {
      if (disposed) return
      setPgnOpen(true)
      setPgnStatus(
        'Copy was blocked. The PGN is selected so you can copy it manually.',
      )
      pgnInput?.focus()
      pgnInput?.select()
    } finally {
      if (!disposed) setCopying(false)
    }
  }

  function openCinema(event: MouseEvent) {
    if (props.busy || cinemaReason()) {
      event.preventDefault()
      return
    }
    try {
      const recipe = createGummyMatchCinemaRecipe(props.match.currentMove()!, {
        ...props.match.appearance(),
      })
      if (!props.match.persist()) {
        event.preventDefault()
        setHandoffError(
          'The match could not be saved, so the studio stayed closed. Copy the PGN before leaving.',
        )
        return
      }
      saveGummyMatchCinemaRecipe(recipe)
      setHandoffError('')
    } catch (cause) {
      event.preventDefault()
      setHandoffError(
        cause instanceof Error
          ? cause.message
          : 'The shot could not be opened. Copy the PGN and try again.',
      )
    }
  }

  return (
    <aside
      id="chess-controls"
      class={styles.sidebar}
      aria-label="Match controls"
      hidden={props.hidden}
    >
      <div class={styles.railHeader}>
        <div>
          <h2>Make it yours</h2>
          <p>Choose the pieces. Set the scene.</p>
        </div>
        <button type="button" class={styles.textButton} onClick={props.onClose}>
          Hide controls
        </button>
      </div>
      <div class={styles.tabs} role="tablist" aria-label="Chess controls">
        <For each={['look', 'game'] as const}>
          {(value) => (
            <button
              type="button"
              role="tab"
              id={`chess-${value}-tab`}
              aria-selected={tab() === value}
              aria-controls={`chess-${value}-panel`}
              tabIndex={tab() === value ? 0 : -1}
              onClick={() => {
                selectTab(value)
              }}
              onKeyDown={(event) => {
                if (
                  !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                    event.key,
                  )
                )
                  return
                event.preventDefault()
                const next =
                  event.key === 'Home'
                    ? 'look'
                    : event.key === 'End'
                      ? 'game'
                      : value === 'look'
                        ? 'game'
                        : 'look'
                selectTab(next)
                document.getElementById(`chess-${next}-tab`)?.focus()
              }}
            >
              {value === 'look' ? 'Pieces & board' : 'Game & moves'}
            </button>
          )}
        </For>
      </div>
      <div class={styles.railScroll} ref={railScroll}>
        <div
          id="chess-look-panel"
          role="tabpanel"
          aria-labelledby="chess-look-tab"
          hidden={tab() !== 'look'}
        >
          <GummyMatchAppearanceControls match={props.match} busy={props.busy} />
        </div>
        <div
          id="chess-game-panel"
          role="tabpanel"
          aria-labelledby="chess-game-tab"
          hidden={tab() !== 'game'}
        >
          <section
            class={styles.historyPanel}
            aria-labelledby="match-history-title"
          >
            <div class={styles.sectionHeader}>
              <h2 id="match-history-title">Moves</h2>
              <button
                class={styles.textButton}
                type="button"
                disabled={props.busy}
                onClick={() => {
                  props.match.newGame()
                  setPgnStatus('')
                  setHandoffError('')
                }}
              >
                New game
              </button>
            </div>
            <Show
              when={props.match.game().history.length > 0}
              fallback={
                <p class={styles.help}>
                  White starts. Play both sides here, or import a game below.
                </p>
              }
            >
              <div class={styles.historyScroll}>
                <table class={styles.history} aria-label="Move history">
                  <thead>
                    <tr>
                      <th scope="col">Move</th>
                      <th scope="col">White</th>
                      <th scope="col">Black</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={historyRows()}>
                      {(row) => (
                        <tr>
                          <th scope="row">{row.number}.</th>
                          <For each={['white', 'black'] as const}>
                            {(color) => (
                              <td>
                                <Show
                                  when={row[color] !== undefined}
                                  fallback={
                                    <span class={styles.emptyMove}>·</span>
                                  }
                                >
                                  <button
                                    type="button"
                                    disabled={props.busy}
                                    class={styles.moveButton}
                                    aria-current={
                                      props.match.cursor() === row[color]! + 1
                                        ? 'step'
                                        : undefined
                                    }
                                    onClick={() => {
                                      props.match.seek(row[color]! + 1)
                                    }}
                                  >
                                    {
                                      props.match.game().history[row[color]!]!
                                        .san
                                    }
                                  </button>
                                </Show>
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <For each={props.match.position().drawClaims}>
              {(claim) => (
                <button
                  class={styles.button}
                  type="button"
                  disabled={props.busy}
                  onClick={() => {
                    props.match.claim(claim)
                  }}
                >
                  Claim draw:{' '}
                  {claim === 'threefold-repetition'
                    ? 'threefold repetition'
                    : 'fifty moves'}
                </button>
              )}
            </For>
          </section>
          <section
            class={styles.cinemaPanel}
            aria-labelledby="match-cinema-title"
          >
            <h2 id="match-cinema-title">Make a capture shot</h2>
            <p class={styles.help}>
              {cinemaReason() ??
                `${props.match.currentMove()!.san} is ready for the shot studio. Your material and board settings go with it.`}
            </p>
            <a
              class={styles.primary}
              href="/gummy?view=cinema&from=match"
              aria-disabled={props.busy || !!cinemaReason()}
              onClick={openCinema}
            >
              <Film aria-hidden="true" />
              Open in Cinema
            </a>
            <Show when={handoffError()}>
              <p class={styles.error} role="alert">
                {handoffError()}
              </p>
            </Show>
          </section>
          <details
            class={styles.section}
            open={pgnOpen()}
            onToggle={(event) => setPgnOpen(event.currentTarget.open)}
          >
            <summary>Import or copy PGN</summary>
            <fieldset class={styles.fields} disabled={props.busy}>
              <label class={styles.label} for="match-pgn">
                Game PGN
              </label>
              <textarea
                id="match-pgn"
                ref={pgnInput}
                class={styles.textarea}
                value={pgn()}
                maxLength={100_000}
                spellcheck={false}
                placeholder="1. e4 e5 2. Nf3 Nc6…"
                onInput={(event) => {
                  setPgn(event.currentTarget.value)
                  setCopied(false)
                  setPgnStatus('')
                }}
              />
              <div class={styles.twoActions}>
                <button
                  class={styles.button}
                  type="button"
                  disabled={!pgn().trim()}
                  onClick={importPgn}
                >
                  Import game
                </button>
                <button
                  class={styles.button}
                  type="button"
                  disabled={copying()}
                  onClick={() => {
                    void copyPgn()
                  }}
                >
                  <Copy aria-hidden="true" />
                  {copied() ? 'Copied' : 'Copy PGN'}
                </button>
              </div>
              <p class={styles.help}>
                Imports one game’s main line. Comments and side variations are
                omitted. Your current game is replaced only after validation.
              </p>
              <p class={styles.help} role="status">
                {pgnStatus()}
              </p>
            </fieldset>
          </details>
          <nav class={styles.studies} aria-label="Gummy studies">
            <a href="/gummy?view=cinema">Shot studio</a>
            <a href="/gummy?view=board">Crash study</a>
            <a href="/gummy?experiment=mpm">Workbench</a>
          </nav>
        </div>
        <Show when={props.match.error()}>
          <p class={styles.error} role="alert">
            {props.match.error()}
          </p>
        </Show>
        <Show when={props.match.notice()}>
          <p class={styles.help} role="status">
            {props.match.notice()}
          </p>
        </Show>
      </div>
      <div class={styles.railFooter}>
        Two players on this device. Your game saves as you play.
      </div>
    </aside>
  )
}
