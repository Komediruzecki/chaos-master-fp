import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { Book, ChevronDown, GridIcon, Info, Menu, SidebarPanel, Star, Zap, } from '@/icons'
import { setActiveTab } from '@/lib/activeTab'
import { BENCHMARKS_PATH } from '@/routing/appPath'
import { VERSION } from '@/version'
import { DebugPanel } from '../Debug/DebugPanel'
import ui from './SoftwareVersion.module.css'
import type { TouchLayoutPreference } from '@/stores/workspaceLayoutStore'

export interface SoftwareVersionProps {
  showHelp: () => void
  showDocs: () => void
  showBenchmark: () => void
  touchLayoutPreference?: () => TouchLayoutPreference
  setTouchLayoutPreference?: (pref: TouchLayoutPreference) => void
  isTouchLayout?: () => boolean
}

export function SoftwareVersion(props: SoftwareVersionProps) {
  const [open, setOpen] = createSignal(false)

  createEffect(() => {
    if (!open() || typeof window === 'undefined') return
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown)
    })
  })

  return (
    <div>
      <DebugPanel />
      <div class={ui.versionContainer}>
        <Show when={open()}>
          <div
            class={ui.popoverBackdrop}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            class={ui.menuPopover}
            role="menu"
            aria-label="Chaos Master menu"
          >
            <Show
              when={
                props.touchLayoutPreference && props.setTouchLayoutPreference
              }
            >
              <button
                type="button"
                role="menuitem"
                class={`${ui.menuItem} ${ui.menuItemHighlight}`}
                onClick={() => {
                  const isTouch = props.isTouchLayout?.()
                  props.setTouchLayoutPreference!(isTouch ? 'desktop' : 'touch')
                  setOpen(false)
                }}
              >
                <SidebarPanel class={ui.menuIcon} />
                <div class={ui.menuMeta}>
                  <span class={ui.menuLabel}>
                    {props.isTouchLayout?.()
                      ? 'Switch to Desktop Layout'
                      : 'Switch to Touch Studio'}
                  </span>
                  <span class={ui.menuSub}>
                    {props.isTouchLayout?.()
                      ? 'Sidebar, dock & inspector'
                      : 'Split tablet & mobile controls'}
                  </span>
                </div>
              </button>
              <div class={ui.menuDivider} />
            </Show>

            <a
              class={`${ui.menuItem} ${ui.arcadePill}`}
              href="#arcade"
              role="menuitem"
              aria-label="Open Lumen Arcade"
              onClick={(ev) => {
                ev.preventDefault()
                setActiveTab('arcade')
                setOpen(false)
              }}
            >
              <Star class={ui.menuIcon} />
              <div class={ui.menuMeta}>
                <span class={ui.menuLabel}>Lumen Arcade</span>
                <span class={ui.menuSub}>Interactive lessons & duels</span>
              </div>
            </a>

            <a
              class={`${ui.menuItem} ${ui.benchmarkLabPill}`}
              href={BENCHMARKS_PATH}
              role="menuitem"
              aria-label="Open Benchmark Lab"
              onClick={() => setOpen(false)}
            >
              <GridIcon class={ui.menuIcon} />
              <div class={ui.menuMeta}>
                <span class={ui.menuLabel}>Benchmark Lab</span>
                <span class={ui.menuSub}>Fractal performance lab</span>
              </div>
            </a>

            <button
              type="button"
              class={ui.menuItem}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                props.showBenchmark()
              }}
            >
              <Zap class={ui.menuIcon} />
              <div class={ui.menuMeta}>
                <span class={ui.menuLabel}>Quick GPU Benchmark</span>
                <span class={ui.menuSub}>Run hardware speed test</span>
              </div>
            </button>

            <button
              type="button"
              class={`${ui.menuItem} ${ui.docsPill}`}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                props.showDocs()
              }}
            >
              <Book class={ui.menuIcon} />
              <div class={ui.menuMeta}>
                <span class={ui.menuLabel}>Documentation</span>
                <span class={ui.menuSub}>User guide & references</span>
              </div>
            </button>

            <button
              type="button"
              class={`${ui.menuItem} ${ui.aboutPill}`}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                props.showHelp()
              }}
            >
              <Info class={ui.menuIcon} />
              <div class={ui.menuMeta}>
                <span class={ui.menuLabel}>About Chaos Master</span>
                <span class={ui.menuSub}>v{VERSION}</span>
              </div>
            </button>
          </div>
        </Show>

        <button
          type="button"
          class={ui.menuTrigger}
          classList={{ [ui.menuTriggerActive as string]: open() }}
          onClick={() => setOpen(!open())}
          aria-expanded={open()}
          aria-haspopup="menu"
          aria-label="Chaos Master menu and version"
          title="Chaos Master menu & version"
        >
          <Menu class={ui.triggerIcon} />
          <span class={ui.triggerLabel}>v{VERSION}</span>
          <ChevronDown
            class={ui.triggerChevron}
            classList={{ [ui.triggerChevronOpen as string]: open() }}
          />
        </button>
      </div>
    </div>
  )
}
