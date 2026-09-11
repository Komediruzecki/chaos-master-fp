import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import { Create, GridIcon, MoreDots } from '@/icons'
import { pushBackHandler } from '@/lib/backStack'
import { haptic } from '@/lib/haptics'
import { buildMoreMenu } from './moreMenu'
import ui from './ShellBar.module.css'
import type { Accessor, Component } from 'solid-js'
import type { MoreMenuHandlers } from './moreMenu'

/** Play is designed but not shown in this phase (DESIGN.md, section 12). */
export type ShellDestination = 'create' | 'library'

/**
 * How long the capsule stays expanded once the finger has left it. Long
 * enough to read the bar and reach it, short enough that the editor gets its
 * band back without being told to.
 */
export const CAPSULE_OPEN_MS = 3000

const DESTINATIONS: readonly {
  readonly id: ShellDestination
  readonly label: string
  readonly Icon: Component<{ class?: string }>
}[] = [
  { id: 'create', label: 'Create', Icon: Create },
  { id: 'library', label: 'Library', Icon: GridIcon },
]

export interface ShellBarProps {
  /** `capsule` is Create: the bar collapses so the editor keeps its canvas. */
  mode: 'full' | 'capsule'
  current: Accessor<ShellDestination>
  onSelect: (destination: ShellDestination) => void
  more: MoreMenuHandlers
}

/**
 * The phone's shell: Create and Library, and More beside them. On Library it
 * is the whole bar; in Create it is a single capsule docked at the leading
 * end of the rail, which expands over the rail while it is wanted and then
 * gives the band back (A/screens.md 27).
 *
 * The platform difference is in the stylesheet only: the floating glass pill
 * everywhere, and Android's full-width Material bar with permanent labels.
 */
export function ShellBar(props: ShellBarProps) {
  const [expanded, setExpanded] = createSignal(false)
  const [held, setHeld] = createSignal(false)
  const [moreOpen, setMoreOpen] = createSignal(false)

  const isCapsule = (destination: ShellDestination) =>
    props.mode === 'capsule' && destination === 'create'
  const open = () => props.mode === 'full' || expanded()
  const moreItems = () => buildMoreMenu(props.more)

  // A finger resting on the capsule is a request to keep the bar up, so the
  // countdown only runs once nothing is holding it.
  createEffect(() => {
    if (props.mode === 'full' || !expanded() || held()) return
    const timer = setTimeout(() => {
      setExpanded(false)
    }, CAPSULE_OPEN_MS)
    onCleanup(() => {
      clearTimeout(timer)
    })
  })

  // Expanded over the rail, the bar is the topmost layer: back gives the
  // editor its band back before anything else answers (lib/backStack.ts).
  createEffect(() => {
    if (!expanded()) return
    onCleanup(
      pushBackHandler(() => {
        setExpanded(false)
      }, 'shell bar'),
    )
  })

  createEffect(() => {
    if (!moreOpen()) return
    onCleanup(
      pushBackHandler(() => {
        setMoreOpen(false)
      }, 'more menu'),
    )
  })

  /**
   * The capsule opens on the touch down and stays up while the finger rests
   * on it; the countdown starts when the finger leaves. The release is
   * watched on the document rather than on this button, and the pointer is
   * deliberately not captured: capturing sends the release - and the click
   * that follows it - back to the capsule even when the finger has slid onto
   * Library, so the one gesture that should reach Library never could.
   */
  let releasing: AbortController | undefined
  onCleanup(() => {
    releasing?.abort()
  })

  function holdCapsule() {
    setExpanded(true)
    setHeld(true)
    releasing?.abort()
    const controller = new AbortController()
    releasing = controller
    const release = () => {
      setHeld(false)
      controller.abort()
    }
    const options = { signal: controller.signal }
    document.addEventListener('pointerup', release, options)
    document.addEventListener('pointercancel', release, options)
  }

  function select(destination: ShellDestination) {
    // motion.md 2.5: one selection tick per destination change, never on a
    // re-tap of the one you are already on.
    if (destination !== props.current()) haptic.selectionChanged()
    props.onSelect(destination)
  }

  return (
    <div
      class={ui.dock}
      classList={{
        [ui.capsuleDock!]: props.mode === 'capsule',
        [ui.expanded!]: expanded(),
      }}
    >
      {/* More is the full bar's, and only the full bar's: in Create the top
          bar already carries the same list, and a popover opened from inside
          the rail's peek row would be clipped by the sheet. */}
      <Show when={props.mode === 'full' && moreOpen()}>
        <div
          class={ui.backdrop}
          data-testid="shell-more-backdrop"
          onClick={() => {
            setMoreOpen(false)
          }}
        />
        <div class={ui.menu} role="menu" aria-label="More">
          <For each={moreItems()}>
            {(item) => (
              <button
                type="button"
                role="menuitem"
                class={ui.menuItem}
                onClick={() => {
                  setMoreOpen(false)
                  item.run()
                }}
              >
                <item.Icon class={ui.menuIcon} />
                <span>{item.label}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class={ui.row}>
        <nav class={ui.bar} aria-label="Destinations">
          <For each={DESTINATIONS}>
            {(destination) => (
              <Show when={open() || isCapsule(destination.id)}>
                <button
                  type="button"
                  class={ui.item}
                  classList={{ [ui.capsule!]: isCapsule(destination.id) }}
                  // Collapsed, the capsule is the whole shell, so it says what
                  // it opens rather than only where it goes.
                  aria-label={
                    isCapsule(destination.id) ? 'Create, navigation' : undefined
                  }
                  aria-expanded={
                    isCapsule(destination.id) ? expanded() : undefined
                  }
                  aria-current={
                    props.current() === destination.id ? 'page' : undefined
                  }
                  onPointerDown={() => {
                    if (!isCapsule(destination.id)) return
                    holdCapsule()
                  }}
                  onClick={() => {
                    if (isCapsule(destination.id)) {
                      // Never a toggle: this click is the release of the very
                      // touch that opened the bar, so toggling here shut it
                      // again the moment the finger lifted. Keyboard
                      // activation brings no pointer down, and this is what
                      // opens the bar for it.
                      setExpanded(true)
                      return
                    }
                    select(destination.id)
                  }}
                >
                  <span class={ui.glyph}>
                    <destination.Icon class={ui.icon} />
                  </span>
                  <span class={ui.label}>{destination.label}</span>
                </button>
              </Show>
            )}
          </For>
        </nav>

        {/* A More that opens an empty menu is worse than no More: a host
            with nothing to put in it does not get the circle. */}
        <Show when={props.mode === 'full' && moreItems().length > 0}>
          <button
            type="button"
            class={ui.more}
            aria-label="More"
            aria-expanded={moreOpen()}
            onClick={() => {
              setMoreOpen((was) => !was)
            }}
          >
            <MoreDots class={ui.icon} />
          </button>
        </Show>
      </div>
    </div>
  )
}
