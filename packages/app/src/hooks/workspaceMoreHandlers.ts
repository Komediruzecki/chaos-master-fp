/** Shared editor actions for the phone HUD, tablet rail and shell menu. */
import { executeCommand } from '@/commands/registry'
import { openBenchmarkLab, openExplorer } from '@/routing/pageLinks'
import type { CommandContext } from '@/commands/types'
import type { MoreMenuHandlers } from '@/components/Shell/moreMenuItems'

interface WorkspaceMoreActions {
  cmdContext: CommandContext
  saveFlameForLater: () => unknown
  inspectChess?: () => void
  showShareLinkModal: () => unknown
  setTouchDrawerOpen: (open: boolean) => void
  showHelp: () => unknown
  showDocumentation: () => unknown
  showBenchmark: () => unknown
  setTouchLayoutPreference: (layout: 'desktop') => void
  showToast: (message: string, duration?: number) => unknown
}

export function createWorkspaceMoreHandlers(
  actions: WorkspaceMoreActions,
): MoreMenuHandlers {
  return {
    onSaveForLater: () => {
      void actions.saveFlameForLater()
    },
    onInspectChess: actions.inspectChess,
    onOpenExportModal: () => {
      executeCommand('export.png', actions.cmdContext)
    },
    onShare: () => {
      void actions.showShareLinkModal()
    },
    onOpenDrawer: () => {
      actions.setTouchDrawerOpen(true)
    },
    onOpenSettings: () => {
      void actions.showHelp()
    },
    onOpenDocs: () => {
      void actions.showDocumentation()
    },
    onOpenBenchmark: () => {
      void actions.showBenchmark()
    },
    onOpenBenchmarkLab: openBenchmarkLab,
    onOpenExplorer: openExplorer,
    onDesktopLayout: () => {
      actions.setTouchLayoutPreference('desktop')
      actions.showToast('Switched to the desktop layout', 3500)
    },
  }
}
