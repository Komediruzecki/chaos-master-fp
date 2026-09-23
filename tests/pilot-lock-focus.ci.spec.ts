/**
 * The keyboard under the Arcade's screen lock, in the real app.
 *
 * A control the viewer focused before the agent took the screen used to keep
 * its focus: the shield took the pointer, but a slider still took its arrows,
 * a field its typing and a button its Space and Enter, each of them editing
 * the take being made. Under the lock the page behind the overlay is inert,
 * focus sits in the overlay, and it comes back to the viewer's control once
 * the lock and its end card are gone.
 *
 * And F with a modifier is the browser's: Ctrl+F is find. A headless browser
 * draws no find bar, so what this checks is the part the page controls: the
 * app does not prevent the key and does not toggle the sidebar on it.
 */
import { dismissWelcomeIfPresent, expect, test } from './helpers'
import type { Locator, Page } from '@playwright/test'

type Envelope = { content: { type: string; text: string }[]; isError?: boolean }

async function callTool(
  page: Page,
  name: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const envelope = await page.evaluate(
    async ([n, i]) => {
      const win = window as unknown as {
        webmcp: {
          execute: (name: string, input: unknown) => Promise<Envelope>
        }
      }
      return await win.webmcp.execute(n, i)
    },
    [name, input] as const,
  )
  return JSON.parse(envelope.content[0]!.text) as Record<string, unknown>
}

async function openEditor(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await dismissWelcomeIfPresent(page, 12_000)
  await page.waitForFunction(() => 'webmcp' in window, undefined, {
    timeout: 20_000,
  })
}

const LOCK_NAME = 'The agent is driving the editor'
const STOP_NAME = 'Stop the agent and keep what was recorded'

async function startLock(page: Page): Promise<Locator> {
  expect(await callTool(page, 'arcade_start_cinema', {})).toMatchObject({
    ok: true,
  })
  const lock = page.getByRole('dialog', { name: LOCK_NAME })
  await expect(lock).toBeVisible()
  return lock
}

/** What has the focus, by its accessible name or its tag. */
async function focused(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'body'
    return el.getAttribute('aria-label') ?? el.tagName
  })
}

async function isFocused(locator: Locator): Promise<boolean> {
  return await locator.evaluate((el) => el === document.activeElement)
}

async function rootIsInert(page: Page): Promise<boolean> {
  return await page.evaluate(
    () => document.getElementById('root')?.hasAttribute('inert') === true,
  )
}

test.describe('the screen lock', () => {
  test('a slider focused before it takes no key, and gets its focus back after', async ({
    page,
  }) => {
    await openEditor(page)
    const slider = page.locator('input[type="range"]:visible').first()
    await expect(slider).toBeVisible()
    await slider.focus()
    const before = await slider.inputValue()

    await startLock(page)

    // Focus left the page for the overlay, and the page is inert behind it.
    expect(await focused(page)).toBe(LOCK_NAME)
    expect(await rootIsInert(page)).toBe(true)
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    expect(await slider.inputValue()).toBe(before)
    // Nor can it take the focus back while the lock is on.
    await slider.evaluate((el) => {
      ;(el as HTMLElement).focus()
    })
    expect(await isFocused(slider)).toBe(false)

    // The theme toggle stays the viewer's (maff's call).
    const theme = await page.evaluate(() => document.body.dataset.theme)
    await page.keyboard.press('Control+d')
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.theme))
      .not.toBe(theme)
    await page.keyboard.press('Control+d')
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.theme))
      .toBe(theme)

    // The overlay's own controls work from the keyboard: Tab reaches Stop,
    // and Enter on it ends the take.
    await page.keyboard.press('Tab')
    expect(await focused(page)).toBe(STOP_NAME)
    await page.keyboard.press('Enter')
    const card = page.getByRole('dialog', { name: /Stopped by you/ })
    await expect(card).toBeVisible()

    // The end card holds the focus the lock had, over a live page.
    expect(await rootIsInert(page)).toBe(false)
    expect(await isFocused(card)).toBe(true)

    // Dismissed, it gives the viewer their slider back, keys and all.
    await page.keyboard.press('Escape')
    await expect(card).toBeHidden()
    expect(await isFocused(slider)).toBe(true)
    await page.keyboard.press('ArrowRight')
    expect(await slider.inputValue()).not.toBe(before)
  })

  test('a field and a button focused before it take nothing either', async ({
    page,
  }) => {
    await openEditor(page)
    const field = page.locator('input[type="number"]:visible').first()
    await expect(field).toBeVisible()
    const fieldBefore = await field.inputValue()
    // By attribute, not by role: an inert control leaves the accessibility
    // tree, so a role query cannot find it while the lock is on.
    const toggle = page
      .locator('button[title^="Breeding features"][aria-expanded]')
      .first()
    await expect(toggle).toBeVisible()
    const expanded = await toggle.getAttribute('aria-expanded')

    await field.focus()
    await startLock(page)
    await page.keyboard.type('7')
    expect(await field.inputValue()).toBe(fieldBefore)
    await page.getByRole('button', { name: STOP_NAME }).click()
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('dialog', { name: /Stopped by you/ }),
    ).toBeHidden()
    expect(await isFocused(field)).toBe(true)

    await toggle.focus()
    await startLock(page)
    await page.keyboard.press('Space')
    await page.keyboard.press('Enter')
    expect(await toggle.getAttribute('aria-expanded')).toBe(expanded)
    // Still locked: neither key reached Stop, which only a focused Stop gets.
    await expect(page.getByRole('dialog', { name: LOCK_NAME })).toBeVisible()
  })
})

test.describe('the sidebar key', () => {
  /** Whether the app claimed the last F: seen by a listener the app's own
   *  run before, unless one of them stopped it. */
  async function watchF(page: Page) {
    await page.evaluate(() => {
      const win = window as unknown as { lastF?: { prevented: boolean } }
      window.addEventListener('keydown', (ev) => {
        if (ev.code === 'KeyF') win.lastF = { prevented: ev.defaultPrevented }
      })
    })
  }

  async function lastF(page: Page) {
    return await page.evaluate(() => {
      const win = window as unknown as { lastF?: { prevented: boolean } }
      const seen = win.lastF
      win.lastF = undefined
      return seen ?? 'stopped'
    })
  }

  const sidebarHidden = async (page: Page) =>
    await page
      .locator('[data-tour-target="canvas"]')
      .evaluate((el) =>
        Array.from(el.classList).some((name) => name.includes('fullscreen')),
      )

  test('Ctrl+F is left to the browser and toggles nothing; F still toggles', async ({
    page,
  }) => {
    await openEditor(page)
    await watchF(page)
    const hidden = await sidebarHidden(page)

    await page.keyboard.press('Control+f')
    expect(await lastF(page)).toEqual({ prevented: false })
    expect(await sidebarHidden(page)).toBe(hidden)

    await page.keyboard.press('f')
    // Claimed: the app stops it before this listener.
    expect(await lastF(page)).toBe('stopped')
    await expect.poll(() => sidebarHidden(page)).toBe(!hidden)
  })
})
