// A reload mid-session ends it cleanly: the agent is told, and does not edit the viewer's flame.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockCommandContext } from '@/webmcp/testUtils'
import type { CommandContext } from '@/commands/types'
import type { WebMcpTool } from '@/webmcp/types'

type McpResult = {
  content: { type: string; text: string }[]
  isError?: boolean
}

/**
 * A reload, as far as module state goes: every module is evaluated again, so
 * the pilot and the duel start idle, while `sessionStorage` is kept.
 */
async function reloadPage(viewer: CommandContext) {
  vi.resetModules()
  const { wrapTool } = await import('./registerWebMcp')
  const { setWebMcpContext } = await import('./contextBridge')
  const tools = await import('./tools')
  // The fresh page installs the viewer's own workspace, as MainWorkspace does.
  setWebMcpContext(viewer)
  const call = async (tool: WebMcpTool, args: unknown = {}) =>
    (await wrapTool(tool).execute(args, {})) as McpResult
  return { call, tools }
}

async function startAgentDuel(ctx: CommandContext) {
  const { setWebMcpContext } = await import('./contextBridge')
  const { beginDuel } = await import('@/arcade/duelActions')
  setWebMcpContext(ctx)
  const started = beginDuel(ctx, { seconds: 90, opponent: 'ai' })
  expect(started).toHaveProperty('ok', true)
}

// Every test evaluates the tool modules afresh, which is seconds under a busy
// full-suite run.
describe(
  'a reload in the middle of an Arcade session',
  { timeout: 30_000 },
  () => {
    afterEach(async () => {
      const { closeDuelView } = await import('@/arcade/duel')
      const { resetPilot } = await import('@/arcade/pilot')
      closeDuelView()
      resetPilot()
      globalThis.sessionStorage.clear()
      vi.resetModules()
    })

    it("holds the agent's tools and says why, instead of acting on the viewer's flame", async () => {
      await startAgentDuel(createMockCommandContext())

      const viewer = createMockCommandContext()
      const { call, tools } = await reloadPage(viewer)

      const read = await call(tools.getFlame)
      expect(read.isError).toBe(true)
      expect(read.content[0]!.text).toMatch(/ended by a page reload/)
      expect(read.content[0]!.text).toMatch(/no Arcade session is active/)

      const before = JSON.stringify(viewer.flameDescriptor())
      const write = await call(tools.executeCommandTool, {
        commandId: 'flame.randomize',
      })
      expect(write.isError).toBe(true)
      expect(JSON.stringify(viewer.flameDescriptor())).toBe(before)

      const endDuel = await call(tools.arcadeEndDuel)
      expect(endDuel.content[0]!.text).toMatch(/no Arcade session is active/)
    })

    it('arcade_status reports the interrupted duel once, then the tools work again', async () => {
      await startAgentDuel(createMockCommandContext())
      const { call, tools } = await reloadPage(createMockCommandContext())

      const status = await call(tools.arcadeStatus)
      expect(status.isError).toBeUndefined()
      const body = JSON.parse(status.content[0]!.text) as {
        phase: string
        interrupted?: { mode: string; reason: string; message: string }
      }
      expect(body.phase).toBe('idle')
      expect(body.interrupted).toMatchObject({ mode: 'duel', reason: 'reload' })

      const again = JSON.parse(
        (await call(tools.arcadeStatus)).content[0]!.text,
      ) as { interrupted?: unknown }
      expect(again.interrupted).toBeUndefined()
      expect((await call(tools.getFlame)).isError).toBeUndefined()
    })

    it('lets the agent start a new duel straight away', async () => {
      await startAgentDuel(createMockCommandContext())
      const { call, tools } = await reloadPage(createMockCommandContext())

      const started = await call(tools.arcadeStartDuel, {
        durationSeconds: 60,
      })
      expect(started.isError).toBeUndefined()
      // The new session supersedes the interrupted one.
      expect((await call(tools.arcadeStatus)).content[0]!.text).not.toMatch(
        /interrupted/,
      )
    })

    it('leaves nothing behind when the session ends through the app', async () => {
      const ctx = createMockCommandContext()
      await startAgentDuel(ctx)
      const { finishDuel } = await import('@/arcade/duelActions')
      await finishDuel(ctx, 'stopped')

      const { call, tools } = await reloadPage(createMockCommandContext())
      expect((await call(tools.getFlame)).isError).toBeUndefined()
    })
  },
)
