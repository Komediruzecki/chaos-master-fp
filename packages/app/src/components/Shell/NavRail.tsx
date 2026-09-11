import { For } from 'solid-js'
import { Create, GridIcon, LumenMark, Settings } from '@/icons'
import { haptic } from '@/lib/haptics'
import ui from './NavRail.module.css'
import type { Accessor, Component } from 'solid-js'
import type { ShellDestination } from './ShellBar'

const DESTINATIONS: readonly {
  readonly id: ShellDestination
  readonly label: string
  readonly Icon: Component<{ class?: string }>
}[] = [
  { id: 'create', label: 'Create', Icon: Create },
  { id: 'library', label: 'Library', Icon: GridIcon },
]

export interface NavRailProps {
  current: Accessor<ShellDestination>
  onSelect: (destination: ShellDestination) => void
  onOpenSettings: () => void
}

/**
 * The tablet's shell: permanent, on the leading edge, at every tablet width
 * (components.md section 9). It never minimises the way the phone's capsule
 * does - a tablet has the width to spare - and it carries Settings at the
 * bottom, which is not a destination but the one thing that has nowhere else
 * to live on a touch layout.
 */
export function NavRail(props: NavRailProps) {
  function select(destination: ShellDestination) {
    if (destination !== props.current()) haptic.selectionChanged()
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
