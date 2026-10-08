/** The shared menu keeps the editor's actions wired after extraction. */
import { describe, expect, it, vi } from 'vitest'
import { executeCommand } from '@/commands/registry'
import { buildMoreMenu } from '@/components/Shell/moreMenuItems'
import { createMockCommandContext } from '@/webmcp/testUtils'
import { createWorkspaceMoreHandlers } from './workspaceMoreHandlers'

vi.mock('@/commands/registry', () => ({ executeCommand: vi.fn() }))
vi.mock('@/routing/pageLinks', () => ({
  openBenchmarkLab: vi.fn(),
  openExplorer: vi.fn(),
}))

describe('createWorkspaceMoreHandlers', () => {
  it('routes existing actions and chess inspection through one menu', () => {
    const actions = {
      cmdContext: createMockCommandContext(),
      saveFlameForLater: vi.fn(),
      inspectChess: vi.fn(),
      showShareLinkModal: vi.fn(),
      setTouchDrawerOpen: vi.fn(),
      showHelp: vi.fn(),
      showDocumentation: vi.fn(),
      showBenchmark: vi.fn(),
      setTouchLayoutPreference: vi.fn(),
      showToast: vi.fn(),
    }
    for (const item of buildMoreMenu(createWorkspaceMoreHandlers(actions))) {
      if (item.label !== 'Lumen Arcade') item.run()
    }
    expect(actions.saveFlameForLater).toHaveBeenCalledOnce()
    expect(actions.inspectChess).toHaveBeenCalledOnce()
    expect(executeCommand).toHaveBeenCalledWith(
      'export.png',
      actions.cmdContext,
    )
    expect(actions.showShareLinkModal).toHaveBeenCalledOnce()
    expect(actions.setTouchDrawerOpen).toHaveBeenCalledWith(true)
    expect(actions.showHelp).toHaveBeenCalledOnce()
    expect(actions.showDocumentation).toHaveBeenCalledOnce()
    expect(actions.showBenchmark).toHaveBeenCalledOnce()
    expect(actions.setTouchLayoutPreference).toHaveBeenCalledWith('desktop')
    expect(actions.showToast).toHaveBeenCalledWith(
      'Switched to the desktop layout',
      3500,
    )
  })
})
