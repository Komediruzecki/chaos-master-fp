import { createSignal, mergeProps, Show } from 'solid-js'
import { executeCommand } from '@/commands/registry'
import { GridIcon, MoreDots, Redo, Undo } from '@/icons'
import { setActiveTab } from '@/lib/activeTab'
import { createBackLayer } from '@/lib/backStack'
import { haptic } from '@/lib/haptics'
import { MoreMenu } from '../Shell/MoreMenu'
import { buildMoreMenu } from '../Shell/moreMenu'
import ui from './TouchSurface.module.css'
import type { Accessor } from 'solid-js'
import type { CommandContext } from '@/commands/types'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

export interface TouchHUDProps {
  ctx: CommandContext
  flame: Accessor<FlameDescriptor>
  canUndo?: Accessor<boolean>
  canRedo?: Accessor<boolean>
  onUndo?: () => void
  onRedo?: () => void
  onOpenExportModal?: () => void
  onShare?: () => void
  onOpenDrawer?: () => void
  onPickGallery?: () => void
  onOpenSettings?: () => void
  onOpenDocs?: () => void
  onOpenBenchmark?: () => void
  /** Web only: the Benchmark Lab is its own page (DESIGN.md, decision 1). */
  onOpenBenchmarkLab?: () => void
  onDesktopLayout?: () => void
}

export function TouchHUD(props: TouchHUDProps) {
  const [showTitleTooltip, setShowTitleTooltip] = createSignal(false)
  const [moreMenuOpen, setMoreMenuOpen] = createSignal(false)

  const dispatch = (id: string, ...args: unknown[]) => {
    executeCommand(id, props.ctx, ...args)
  }

  const flameName = () =>
    props.flame().metadata?.name?.trim() || 'Untitled flame'

  /**
   * The one More list (components/Shell/moreMenu.ts), so the top bar and the
   * shell bar offer the same items. The Arcade is reachable from every touch
   * surface, so it defaults here rather than making every host pass it.
   */
  const handlers = mergeProps(
    {
      onOpenArcade: () => {
        setActiveTab('arcade')
      },
    },
    props,
  )
  const moreItems = () => buildMoreMenu(handlers)

  const closePopovers = () => {
    setShowTitleTooltip(false)
    setMoreMenuOpen(false)
  }

  // Both popovers are layers: back closes the open one before anything else
  // answers (lib/backStack.ts), the same as a tap on the backdrop. The More
  // list registers itself (Shell/MoreMenu.tsx).
  createBackLayer(
    showTitleTooltip,
    () => {
      setShowTitleTooltip(false)
    },
    'flame title',
  )

  return (
    <>
      {/* Outside the pill on purpose: the pill's backdrop-filter and its
          centring transform make it the containing block for a fixed child,
          so `inset: 0` inside it measured the pill and a tap on the canvas
          never reached this. It sits under the pill and over everything
          else. */}
      <Show when={showTitleTooltip() || moreMenuOpen()}>
        <div
          class={ui.popoverBackdrop}
          data-testid="hud-popover-backdrop"
          onClick={closePopovers}
        />
      </Show>
      <header class={ui.topHud} role="banner" aria-label="Touch Navigation HUD">
        <button
          type="button"
          class={ui.hudButton}
          onClick={() => {
            props.onPickGallery?.()
          }}
          title="Library"
          aria-label="Library"
        >
          <GridIcon class={ui.hudButtonIcon} />
        </button>

        <div class={ui.hudTitleWrapper}>
          <button
            type="button"
            class={ui.hudTitleBtn}
            onClick={() => {
              setShowTitleTooltip((prev) => !prev)
            }}
            title={flameName()}
            aria-label={`Flame title: ${flameName()}`}
          >
            <span class={ui.hudTitleText}>{flameName()}</span>
          </button>

          <Show when={showTitleTooltip()}>
            <div class={ui.titleTooltip} role="tooltip">
              <strong>{flameName()}</strong>
              <Show when={props.flame().metadata?.description}>
                <div class={ui.titleTooltipBody}>
                  {props.flame().metadata?.description}
                </div>
              </Show>
            </div>
          </Show>
        </div>

        <button
          type="button"
          class={ui.hudButton}
          title="Undo"
          aria-label="Undo"
          disabled={props.canUndo ? !props.canUndo() : false}
          onPointerDown={() => {
            haptic.impactLight()
          }}
          onClick={() => {
            if (props.onUndo) props.onUndo()
            else dispatch('history.undo')
          }}
        >
          <Undo class={ui.hudButtonIcon} />
        </button>

        <button
          type="button"
          class={ui.hudButton}
          title="Redo"
          aria-label="Redo"
          disabled={props.canRedo ? !props.canRedo() : false}
          onPointerDown={() => {
            haptic.impactLight()
          }}
          onClick={() => {
            if (props.onRedo) props.onRedo()
            else dispatch('history.redo')
          }}
        >
          <Redo class={ui.hudButtonIcon} />
        </button>

        <div class={ui.moreMenuWrapper}>
          <button
            type="button"
            class={ui.hudButton}
            title="More"
            aria-label="More"
            aria-expanded={moreMenuOpen()}
            onClick={() => setMoreMenuOpen((o) => !o)}
          >
            <MoreDots class={ui.hudButtonIcon} />
          </button>

          <MoreMenu
            items={moreItems()}
            open={moreMenuOpen()}
            onClose={() => {
              setMoreMenuOpen(false)
            }}
            menuClass={ui.moreMenuPopover!}
          />
        </div>
      </header>
    </>
  )
}
