// Verify real tab hiding without Playwright's default per-target focus override.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'

export async function verifyVisibility(base: string) {
  const profile = await mkdtemp(path.join(tmpdir(), 'lumen-visibility-'))
  const child = spawn(
    chromium.executablePath(),
    [
      '--class=agent-browser',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--ignore-certificate-errors',
      '--enable-features=Vulkan',
      '--ignore-gpu-blocklist',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  let launchError: Error | undefined
  child.on('error', (error) => {
    launchError = error
  })
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => {
      resolve()
    }),
  )
  let browser: Browser | undefined
  try {
    let port = ''
    const deadline = Date.now() + 10000
    while (Date.now() < deadline && !port) {
      if (launchError) throw launchError
      if (child.exitCode !== null)
        throw new Error('Visibility browser exited during startup')
      try {
        port = (
          await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
        ).split('\n')[0]
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    if (!port) throw new Error('Visibility browser startup timed out')
    // noDefaults only affects an attached browser's default context. Creating
    // a normal Playwright context would force visibility back to "visible".
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      noDefaults: true,
    })
    const context = browser.contexts()[0]
    const page = context.pages()[0]
    await page.goto(base)
    await page.getByRole('button', { name: 'Play music', exact: true }).click()
    await page
      .getByRole('button', { name: 'Pause music', exact: true })
      .waitFor()
    const other = await context.newPage()
    await other.bringToFront()
    await page.waitForFunction(() => document.hidden, undefined, {
      polling: 100,
    })
    await page
      .getByRole('button', { name: 'Play music', exact: true })
      .waitFor({ state: 'attached' })
    assert.ok(
      (await page.locator('.transport').textContent())?.includes('paused'),
    )
    await other.close()
    await page.bringToFront()
    await page.waitForFunction(() => !document.hidden, undefined, {
      polling: 100,
    })
    assert.ok(
      (await page.locator('.transport').textContent())?.includes('paused'),
      'Returning does not autoplay',
    )
    await page.getByRole('button', { name: 'Play music', exact: true }).click()
    await page
      .getByRole('button', { name: 'Pause music', exact: true })
      .waitFor()
    await page.getByRole('button', { name: 'Pause music', exact: true }).click()
    return {
      actualTabHidden: true,
      pausedOnHide: true,
      noAutoplayOnReturn: true,
      explicitResume: true,
    }
  } finally {
    await browser?.close()
    child.kill()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 3000)
      }),
    ])
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    })
  }
}
