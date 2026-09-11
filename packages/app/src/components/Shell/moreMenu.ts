import { Book, Download, GaugeMax, Info, Menu, Share, SidebarPanel, Zap, } from '@/icons'
import type { Component } from 'solid-js'

/**
 * The one More list. The top bar and the shell bar both render it, so an item
 * added here shows up wherever More is offered. An item whose handler is
 * absent is not offered: the host decides what this device can do (the
 * Benchmark Lab is a page of its own and web only, the desktop layout is not
 * a native option).
 *
 * The names are the props `TouchHUDProps` already carries, so a surface can
 * pass its own props straight in.
 */
export interface MoreMenuHandlers {
  onOpenExportModal?: () => void
  onShare?: () => void
  onOpenDrawer?: () => void
  onOpenArcade?: () => void
  onOpenDocs?: () => void
  onOpenBenchmark?: () => void
  onOpenBenchmarkLab?: () => void
  onOpenSettings?: () => void
  onDesktopLayout?: () => void
}

export interface MoreMenuItem {
  readonly label: string
  readonly Icon: Component<{ class?: string }>
  readonly run: () => void
}

export function buildMoreMenu(
  handlers: MoreMenuHandlers,
): readonly MoreMenuItem[] {
  const table: readonly {
    label: string
    Icon: Component<{ class?: string }>
    run: (() => void) | undefined
  }[] = [
    {
      label: 'Export options',
      Icon: Download,
      run: handlers.onOpenExportModal,
    },
    { label: 'Share link', Icon: Share, run: handlers.onShare },
    { label: 'Advanced tools', Icon: SidebarPanel, run: handlers.onOpenDrawer },
    { label: 'Lumen Arcade', Icon: Zap, run: handlers.onOpenArcade },
    { label: 'Documentation', Icon: Book, run: handlers.onOpenDocs },
    {
      label: 'Quick GPU benchmark',
      Icon: Zap,
      run: handlers.onOpenBenchmark,
    },
    {
      label: 'Benchmark Lab',
      Icon: GaugeMax,
      run: handlers.onOpenBenchmarkLab,
    },
    { label: 'Settings and more', Icon: Info, run: handlers.onOpenSettings },
    { label: 'Desktop layout', Icon: Menu, run: handlers.onDesktopLayout },
  ]
  return table.filter((item): item is MoreMenuItem => item.run !== undefined)
}
