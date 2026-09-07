import { Show } from 'solid-js'
import { executeCommand } from '@/commands/registry'
import { CameraIcon, GridIcon, Redo, Shuffle, SidebarPanel, Sparkle, Undo, } from '@/icons'
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
  onRandomize?: () => void
  onMutate?: () => void
  onSnapshot?: () => void
  onOpenDrawer?: () => void
  onPickGallery?: () => void
}

export function TouchHUD(props: TouchHUDProps) {
  const dispatch = (id: string, ...args: unknown[]) => {
    executeCommand(id, props.ctx, ...args)
  }

  return (
    <header class={ui.topHud} role="banner" aria-label="Touch Navigation HUD">
      <button
        type="button"
        class={ui.hudTitleBtn}
        onClick={() => {
          props.onPickGallery?.()
        }}
        title={props.flame().metadata?.name || 'Chaos Master'}
        aria-label="Browse & load flames from gallery"
      >
        <GridIcon class={ui.hudTitleIcon} />
        <span class={ui.hudTitleText}>
          {props.flame().metadata?.name || 'Chaos Master'}
        </span>
      </button>

      <div class={ui.hudActions} role="toolbar" aria-label="Quick Actions">
        <button
          type="button"
          class={ui.hudButton}
          title="Undo"
          aria-label="Undo"
          disabled={props.canUndo ? !props.canUndo() : false}
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
          onClick={() => {
            if (props.onRedo) props.onRedo()
            else dispatch('history.redo')
          }}
        >
          <Redo class={ui.hudButtonIcon} />
        </button>

        <button
          type="button"
          class={ui.hudButton}
          title="Mutate"
          aria-label="Mutate"
          onClick={() => {
            if (props.onMutate) props.onMutate()
            else dispatch('flame.mutate')
          }}
        >
          <Sparkle class={ui.hudButtonIcon} />
        </button>

        <button
          type="button"
          class={ui.hudButton}
          title="Randomize"
          aria-label="Randomize"
          onClick={() => {
            if (props.onRandomize) props.onRandomize()
            else dispatch('flame.randomize')
          }}
        >
          <Shuffle class={ui.hudButtonIcon} />
        </button>

        <button
          type="button"
          class={ui.hudButton}
          title="Snapshot PNG"
          aria-label="Snapshot PNG"
          onClick={() => {
            if (props.onSnapshot) props.onSnapshot()
            else dispatch('export.png')
          }}
        >
          <CameraIcon class={ui.hudButtonIcon} />
        </button>

        <Show when={props.onOpenDrawer}>
          <button
            type="button"
            class={ui.hudButton}
            title="More Tools"
            aria-label="More Tools"
            onClick={props.onOpenDrawer}
          >
            <SidebarPanel class={ui.hudButtonIcon} />
          </button>
        </Show>
      </div>
    </header>
  )
}
