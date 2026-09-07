import { createEffect, For, onCleanup, Show } from 'solid-js'
import { CameraIcon, Cross, Film, Lineage, MusicNote, Robot, Swords, } from '@/icons'
import ui from './TouchSurface.module.css'

export interface AdvancedToolsDrawerProps {
  open: boolean
  onClose: () => void
  onArtDirector?: () => void
  onFlameClash?: () => void
  onBreed?: () => void
  onAudio?: () => void
  onSonification?: () => void
  onTimelineToggle?: () => void
  onExportPng?: () => void
  onShare?: () => void
}

export function AdvancedToolsDrawer(props: AdvancedToolsDrawerProps) {
  createEffect(() => {
    if (!props.open || typeof window === 'undefined') return
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        props.onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown)
    })
  })

  const tools = [
    {
      id: 'art-director',
      title: 'Art Director Mode',
      subtitle: 'Evolutionary AI taste and flame curation',
      icon: Robot,
      action: () => {
        props.onArtDirector?.()
        props.onClose()
      },
    },
    {
      id: 'arena-clash',
      title: 'Flame Clash Arena',
      subtitle: '3D/2D kinetic fractal combat and champion cards',
      icon: Swords,
      action: () => {
        props.onFlameClash?.()
        props.onClose()
      },
    },
    {
      id: 'genetics-breeding',
      title: 'Breeding & Genetics',
      subtitle: 'Cross-breed and morph flame genomes',
      icon: Lineage,
      action: () => {
        props.onBreed?.()
        props.onClose()
      },
    },
    {
      id: 'audio-reactive',
      title: 'Audio Reactive & Beats',
      subtitle: 'Drive flame motion and colors from music audio',
      icon: MusicNote,
      action: () => {
        props.onAudio?.()
        props.onClose()
      },
    },
    {
      id: 'timeline-animation',
      title: 'Timeline & Keyframes',
      subtitle: 'Toggle multi-track animation and sequencing',
      icon: Film,
      action: () => {
        props.onTimelineToggle?.()
        props.onClose()
      },
    },
    {
      id: 'high-res-export',
      title: 'High-Res Export',
      subtitle: 'Render and download master PNG render',
      icon: CameraIcon,
      action: () => {
        props.onExportPng?.()
        props.onClose()
      },
    },
  ]

  return (
    <Show when={props.open}>
      <div
        class={ui.drawerBackdrop}
        onClick={props.onClose}
        aria-hidden="true"
      />
      <aside
        class={ui.drawerPanel}
        role="dialog"
        aria-modal="true"
        aria-label="Advanced Tools Drawer"
      >
        <header class={ui.drawerHeader}>
          <h3 class={ui.drawerTitle}>Advanced Tools</h3>
          <button
            type="button"
            class={ui.iconBtnSmall}
            onClick={props.onClose}
            aria-label="Close Advanced Tools"
          >
            <Cross class={ui.hudButtonIcon} />
          </button>
        </header>

        <div class={ui.drawerBody}>
          <For each={tools}>
            {(t) => (
              <button type="button" class={ui.drawerCard} onClick={t.action}>
                <t.icon class={ui.drawerCardIcon} />
                <div class={ui.drawerCardMeta}>
                  <div class={ui.drawerCardTitle}>{t.title}</div>
                  <div class={ui.drawerCardSubtitle}>{t.subtitle}</div>
                </div>
              </button>
            )}
          </For>
        </div>
      </aside>
    </Show>
  )
}
