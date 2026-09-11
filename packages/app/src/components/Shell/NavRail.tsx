import { For } from 'solid-js'
import { LumenMark, Settings } from '@/icons'
import { DESTINATIONS, tickForDestination } from './destinations'
import ui from './NavRail.module.css'
import type { Accessor } from 'solid-js'
import type { ShellDestination } from './destinations'

export interface NavRailProps {
  current: Accessor<ShellDestination>
  onSelect: (destination: ShellDestination) => void
  onOpenSettings: () => void
}

/**
 * The tablet's shell: permanent on the leading edge wherever the inspector
 * deck fits (the 900px rule in stores/workspaceLayoutStore.ts), not at every
 * tablet width - a portrait iPad or a Split View pane below it gets the
 * phone's rail with the capsule docked in it instead.
 *
 * Where it does mount it is genuinely permanent: Library is inset by this
 * column (Home/HomeTab.module.css `.deck`) rather than covering it, so the
 * rail stays visible and tappable on every destination. It never minimises
 * the way the capsule does - a tablet has the width to spare - and it
 * carries Settings at the bottom, which is not a destination but the one
 * thing with nowhere else to live on a touch layout.
 */
export function NavRail(props: NavRailProps) {
  function select(destination: ShellDestination) {
    tickForDestination(destination, props.current())
    props.onSelect(destination)
  }

  return (
    <nav class={ui.rail} aria-label="Destinations">
      {/* The mark carries its own two inks and is never tinted. */}
      <LumenMark class={ui.mark} />
      <For each={DESTINATIONS}>
        {(destination) => (
          <button
            type="button"
            class={ui.item}
            aria-current={
              props.current() === destination.id ? 'page' : undefined
            }
            onClick={() => {
              select(destination.id)
            }}
          >
            <destination.Icon class={ui.icon} />
            {destination.label}
          </button>
        )}
      </For>
      <div class={ui.spacer} />
      <button
        type="button"
        class={ui.item}
        onClick={() => {
          props.onOpenSettings()
        }}
      >
        <Settings class={ui.icon} />
        Settings
      </button>
    </nav>
  )
}
