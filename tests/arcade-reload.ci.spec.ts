/**
 * A reload in the middle of an agent's Arcade session, in the real app.
 *
 * The session is module state, so the reload ends it. Before, nothing said
 * so: `arcade_status` read idle, and the agent's next `get_flame` and
 * `execute_command` read and edited the viewer's own flame. Now every tool
 * but `arcade_status` and the `arcade_start_*` tools answers that the session
 * was ended by the reload, until the agent reads `arcade_status`, and the
 * viewer is told in a toast.
 */
import { expect, test } from './helpers'
import { openEditor } from './pilotLock'
import type { Page } from '@playwright/test'

type Envelope = { content: { type: string; text: string }[]; isError?: boolean }

async function call(page: Page, name: string, input: unknown = {}) {
  return await page.evaluate(
    async ([n, i]) => {
      const win = window as unknown as {
        webmcp: { execute: (name: string, input: unknown) => Promise<Envelope> }
      }
      return await win.webmcp.execute(n, i)
    },
    [name, input] as const,
  )
}

test.describe('a reload during an agent duel', () => {
  test("ends it, tells the agent and the viewer, and keeps the agent off the viewer's flame", async ({
    page,
  }) => {
    await openEditor(page)
    const started = await call(page, 'arcade_start_duel', {
      durationSeconds: 120,
    })
    expect(started.isError).toBeUndefined()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => 'webmcp' in window, undefined, {
      timeout: 20_000,
    })

    await expect(
      page.getByText("The reload ended the agent's duel."),
    ).toBeVisible()

    const read = await call(page, 'get_flame')
    expect(read.isError).toBe(true)
    expect(read.content[0]!.text).toContain(
      'The Arcade duel "Duelling you" was ended by a page reload, and no Arcade session is active.',
    )
    const write = await call(page, 'execute_command', {
      commandId: 'flame.randomize',
    })
    expect(write.isError).toBe(true)

    const status = JSON.parse(
      (await call(page, 'arcade_status')).content[0]!.text,
    ) as {
      phase: string
      interrupted?: { mode: string; reason: string }
    }
    expect(status.phase).toBe('idle')
    expect(status.interrupted).toMatchObject({ mode: 'duel', reason: 'reload' })

    // Acknowledged: the tools are the viewer's again, as they are with no
    // session running.
    expect((await call(page, 'get_flame')).isError).toBeUndefined()
  })
})
