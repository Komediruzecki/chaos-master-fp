/** Arcade destinations: directly playable chess and the agent-led creative modes. */
import { createEffect, createSignal, For, lazy, onCleanup, onMount, Show, Suspense, } from 'solid-js'
import { Book, ChevronLeft, ChevronRight, Film, Lineage, MusicNote, Swords, Zap, } from '@/icons'
import { arcadeMode, setActiveTab } from '@/lib/activeTab'
import ui from './ArcadeHub.module.css'
import { ArcadeModePanel } from './ArcadeModePanel'
import { WebMcpStatusPill } from './WebMcpStatusPill'
import type { Component } from 'solid-js'
import type { ArcadeDestination, ArcadeMode } from '@/lib/activeTab'

const ChessWorld = lazy(() =>
  import('@/pages/GummyBoard/GummyMatchPage').then((module) => ({
    default: module.GummyMatchPage,
  })),
)

type CardId = ArcadeMode
type CardDef = {
  id: CardId
  title: string
  tagline: string
  tag: string
  ready: boolean
  icon: Component<{ class?: string }>
}

export const ARCADE_MODES: CardDef[] = [
  {
    id: 'teach',
    title: 'Teach',
    tagline:
      'The agent builds a flame step by step and records a lesson you can replay.',
    tag: 'Agent drives',
    ready: true,
    icon: Book,
  },
  {
    id: 'cinema',
    title: 'Cinema',
    tagline:
      'Describe a move; the agent keyframes a cinematic animation of your flame.',
    tag: 'Agent drives',
    ready: true,
    icon: Film,
  },
  {
    id: 'duel',
    title: 'Duel',
    tagline:
      'Race the agent to the better flame, side by side against the clock.',
    tag: 'You + agent',
    ready: true,
    icon: Swords,
  },
  {
    id: 'beats',
    title: 'Beats',
    tagline: 'The agent wires your flame to a song so it dances.',
    tag: 'Agent drives',
    ready: true,
    icon: MusicNote,
  },
  {
    id: 'arena',
    title: 'Arena',
    tagline: 'Flames clash on real stats; the winner gets a shareable card.',
    tag: 'Agent clashes',
    ready: true,
    icon: Zap,
  },
  {
    id: 'director',
    title: 'Director',
    tagline: 'The agent learns your taste and evolves flames toward it.',
    tag: 'Agent drives',
    ready: true,
    icon: Lineage,
  },
]

export function ArcadeHub(props: {
  initialMode?: ArcadeDestination
  onBackToEditor: () => void
}) {
  const [open, setOpen] = createSignal<ArcadeDestination | undefined>(
    props.initialMode,
  )
  createEffect(() => setOpen(arcadeMode()))
  onMount(() => {
    // Esc on the hub root leaves for the editor. With a panel open the panel
    // handles Esc itself and stops the event, so this never sees it.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return
      const target = ev.target
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"]',
        )
      )
        return
      if (open() && open() !== 'chess') return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      if (open() === 'chess') setActiveTab('arcade')
      else props.onBackToEditor()
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey)
    })
  })
  const closeChess = () => {
    setActiveTab('arcade')
  }
  return (
    <Show
      when={open() === 'chess'}
      fallback={
        <section class={ui.hub} aria-label="Lumen Arcade">
          {/* The way out, pinned. The footer carries the same action, but it is
          below the whole card grid: on a touch device leaving meant scrolling
          past every card, and the Esc that covers this for a keyboard is not
          a key a tablet has. */}
          <button
            type="button"
            class={ui.back}
            data-testid="arcade-back"
            aria-label="Back to editor"
            title="Back to editor"
            onClick={props.onBackToEditor}
          >
            <ChevronLeft class={ui.backIcon} aria-hidden="true" />
          </button>
          <header class={ui.header}>
            <h1 class={ui.wordmark}>Lumen Arcade</h1>
            <p class={ui.promise}>
              Play a game of gummy chess, or build, animate and explore fractals
              with an agent.
            </p>
            <WebMcpStatusPill />
          </header>
          <button
            type="button"
            class={ui.chessCard}
            data-testid="arcade-chess"
            onClick={() => {
              setActiveTab('arcade', 'chess')
            }}
          >
            <img
              src="/assets/chess/board-classic.webp"
              alt="Sculpted gummy chess pieces on a checkerboard"
              width="960"
              height="600"
            />
            <span class={ui.chessCopy}>
              <span class={ui.chessTitle}>Chess</span>
              <span>
                Choose your pieces. Make your move. Watch the capture.
              </span>
              <span class={ui.chessAction}>
                Play on this device <ChevronRight aria-hidden="true" />
              </span>
            </span>
          </button>
          <div class={ui.grid}>
            <For each={ARCADE_MODES}>
              {(card) => (
                <button
                  type="button"
                  class={ui.card}
                  classList={{ [ui.cardDisabled!]: !card.ready }}
                  data-testid="arcade-card"
                  data-mode={card.id}
                  disabled={!card.ready}
                  aria-disabled={!card.ready}
                  onClick={() => {
                    if (card.ready) {
                      setActiveTab('arcade', card.id)
                    }
                  }}
                >
                  <div class={ui.art} data-mode={card.id}>
                    <card.icon class={ui.artIcon} />
                  </div>
                  <div class={ui.cardTitle}>{card.title}</div>
                  <div class={ui.cardTagline}>{card.tagline}</div>
                  <div class={ui.cardTag}>
                    {card.ready ? card.tag : 'Roadmap'}
                  </div>
                </button>
              )}
            </For>
          </div>
          <footer class={ui.footer}>
            <button type="button" onClick={props.onBackToEditor}>
              Back to editor
            </button>
            <a
              href="https://github.com/chaos-matters/chaos-master/blob/main/docs/webmcp.md"
              target="_blank"
              rel="noreferrer"
            >
              How it works
            </a>
          </footer>
          <Show
            when={
              open() && open() !== 'chess' ? (open() as ArcadeMode) : undefined
            }
          >
            {(mode) => (
              <ArcadeModePanel
                mode={mode()}
                onClose={() => {
                  setActiveTab('arcade')
                }}
              />
            )}
          </Show>
        </section>
      }
    >
      <div class={ui.chessWorld}>
        <Suspense
          fallback={
            <p class={ui.chessLoading} role="status">
              Opening chess…
            </p>
          }
        >
          <ChessWorld onBackToArcade={closeChess} />
        </Suspense>
      </div>
    </Show>
  )
}
