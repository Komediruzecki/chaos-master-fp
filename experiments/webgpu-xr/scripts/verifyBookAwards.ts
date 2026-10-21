// Hardware-browser proof that saved awards control the two raised page meshes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { createJourneyStore, JOURNEY_STORAGE_KEY, } from '../src/journey/progress'
import type { BookAwards } from '../src/almanac/bookAwards'

const out = process.env.VERIFY_OUT_DIR
assert.ok(out, 'Set VERIFY_OUT_DIR to a registered agent-out run')
await mkdir(out, { recursive: true })
const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
const store = createJourneyStore({ worlds: ALMANAC_WORLDS })
store.completeOnboarding()
const saves = [store.read().progress]
store.completeWorld('glasswake')
saves.push(store.read().progress)
store.completeWorld('tideweave')
saves.push(store.read().progress)
const expected: BookAwards[] = [
  { glasswake: false, tideweave: false },
  { glasswake: true, tideweave: false },
  { glasswake: true, tideweave: true },
]
const report: Record<string, unknown> = { nativeHeadsetTested: false }
const errors: string[] = []
const browser = await chromium.launch({
  headless: false,
  env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
  args: [
    '--class=agent-browser',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
})
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 950 },
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /computations created outside/.test(message.text())
    )
      errors.push(message.text())
  })
  await page.goto(`${base}/almanac`)
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    const cdp = await browser.newBrowserCDPSession()
    const processes = await cdp.send('SystemInfo.getProcessInfo')
    const pid = processes.processInfo.find(
      (entry) => entry.type === 'browser',
    )!.id
    await cdp.detach()
    const clients = JSON.parse(
      execFileSync('hyprctl', ['-j', 'clients'], { encoding: 'utf8' }),
    ) as { pid: number; class: string; workspace: { name: string } }[]
    const owned = clients.filter((client) => client.pid === pid)
    assert.ok(
      owned.length &&
        owned.every(
          (client) =>
            client.class === 'agent-browser' &&
            client.workspace.name === 'special:agents',
        ),
    )
  }
  await page.waitForFunction(
    () => window.__almanac?.runtime.snapshot().book.reliefStatus === 'ready',
    undefined,
    { timeout: 60000 },
  )
  const initial = await page.evaluate(() =>
    window.__almanac!.runtime.snapshot(),
  )
  assert.ok(!/swiftshader|llvmpipe/i.test(initial.adapter))
  report.adapter = initial.adapter
  const samples = []
  for (let index = 0; index < saves.length; index++) {
    await page.evaluate(
      ({ key, progress }) => {
        const oldValue = localStorage.getItem(key)
        const newValue = JSON.stringify(progress)
        localStorage.setItem(key, newValue)
        window.dispatchEvent(
          new StorageEvent('storage', {
            key,
            oldValue,
            newValue,
            storageArea: localStorage,
          }),
        )
      },
      { key: JOURNEY_STORAGE_KEY, progress: saves[index] },
    )
    await page.waitForFunction(
      (awards) =>
        JSON.stringify(window.__almanac?.runtime.snapshot().book.awards) ===
        JSON.stringify(awards),
      expected[index],
    )
    const current = await page.evaluate(() =>
      window.__almanac!.runtime.snapshot(),
    )
    assert.equal(current.book.draws, index + 1)
    assert.equal(
      current.generation,
      initial.generation,
      'Earning a page must not resample the flame',
    )
    assert.equal(
      current.bufferBytes,
      initial.bufferBytes,
      'Awards reuse uploaded meshes',
    )
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      JOURNEY_STORAGE_KEY,
    )
    assert.deepEqual(
      stored,
      saves[index],
      'The rendering effect must not rewrite progress',
    )
    await page
      .locator('canvas')
      .screenshot({ path: path.join(out, `awards-${index}.png`) })
    samples.push(current.book)
  }
  await page.reload()
  await page.waitForFunction(
    () => window.__almanac?.runtime.snapshot().book.reliefStatus === 'ready',
    undefined,
    { timeout: 60000 },
  )
  assert.deepEqual(
    (await page.evaluate(() => window.__almanac!.runtime.snapshot())).book
      .awards,
    expected[2],
  )
  const stable = await page.evaluate(
    () => window.__almanac!.runtime.snapshot().bufferBytes,
  )
  await page.evaluate(() => {
    window.__almanac!.runtime.retryBook()
  })
  await page.waitForFunction(
    () => window.__almanac?.runtime.snapshot().book.reliefStatus === 'ready',
    undefined,
    { timeout: 60000 },
  )
  assert.equal(
    await page.evaluate(() => window.__almanac!.runtime.snapshot().bufferBytes),
    stable,
  )
  await page.goto(`${base}/observatory`)
  await page.waitForFunction(
    () =>
      window.__observatory?.runtime.snapshot().ready &&
      window.__observatory.runtime
        .snapshot()
        .assets.every((asset) => asset.status === 'ready'),
    undefined,
    { timeout: 60000 },
  )
  assert.deepEqual(
    await page.evaluate(
      () => window.__observatory!.runtime.snapshot().visual.bookAwards,
    ),
    expected[2],
  )
  report.samples = samples
  report.reloadAndRetry = true
  report.observatoryEarnedState = true
  await page.evaluate(() => {
    window.__observatory!.runtime.loseDeviceForTest()
  })
  await page.waitForFunction(() =>
    Boolean(window.__observatory?.runtime.snapshot().error),
  )
  await page.evaluate((key) => {
    window.dispatchEvent(
      new StorageEvent('storage', { key, storageArea: localStorage }),
    )
  }, JOURNEY_STORAGE_KEY)
  assert.match(
    await page.evaluate(() => window.__observatory!.runtime.snapshot().error),
    /GPU device lost/,
  )
  report.progressRefreshAfterDeviceLoss = 'responsive, reload still required'

  const blockedContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1024, height: 768 },
  })
  const blockedPage = await blockedContext.newPage()
  blockedPage.on('pageerror', (error) => errors.push(String(error)))
  await blockedPage.route('**/glasswake-earned.glb', (route) =>
    route.fulfill({ status: 404, body: 'asset unavailable' }),
  )
  await blockedPage.goto(`${base}/almanac`)
  await blockedPage.waitForFunction(
    () => window.__almanac?.runtime.snapshot().book.reliefStatus === 'error',
    undefined,
    { timeout: 60000 },
  )
  const partial = await blockedPage.evaluate(() =>
    window.__almanac!.runtime.snapshot(),
  )
  assert.equal(
    partial.book.status,
    'ready',
    'A missing optional relief must not hide the book',
  )
  assert.equal(partial.book.draws, 1, 'An unearned relief must not render')
  assert.match(partial.book.reliefError, /glasswake/)
  await blockedPage.unroute('**/glasswake-earned.glb')
  await blockedPage
    .getByRole('button', { name: 'Retry page details', exact: true })
    .click()
  await blockedPage.waitForFunction(
    () => window.__almanac?.runtime.snapshot().book.reliefStatus === 'ready',
    undefined,
    { timeout: 60000 },
  )
  report.optionalReliefFailureAndRetry = true
  const tideOnly = createJourneyStore({ worlds: ALMANAC_WORLDS })
  tideOnly.completeOnboarding()
  tideOnly.completeWorld('tideweave')
  await blockedPage.evaluate(
    ({ key, progress }) => {
      localStorage.setItem(key, JSON.stringify(progress))
      window.dispatchEvent(
        new StorageEvent('storage', { key, storageArea: localStorage }),
      )
    },
    { key: JOURNEY_STORAGE_KEY, progress: tideOnly.read().progress },
  )
  await blockedPage.waitForFunction(
    () => window.__almanac?.runtime.snapshot().book.awards.tideweave,
  )
  const tideState = await blockedPage.evaluate(() =>
    window.__almanac!.runtime.snapshot(),
  )
  assert.deepEqual(tideState.book.awards, { glasswake: false, tideweave: true })
  assert.equal(tideState.book.draws, 2)
  assert.equal(tideState.error, '')
  await blockedPage
    .locator('canvas')
    .screenshot({ path: path.join(out, 'awards-tideweave.png') })
  report.tideweaveOnly = true
  await blockedContext.close()
  assert.deepEqual(errors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = String(error)
  throw error
} finally {
  report.errors = errors
  await writeFile(
    path.join(out, 'book-awards.json'),
    JSON.stringify(report, null, 2),
  )
  await browser.close()
  console.info(JSON.stringify({ status: report.status, out, errors }))
}
