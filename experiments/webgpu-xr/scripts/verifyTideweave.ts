// Bounded real-hardware desktop proof for Tideweave art, earned growth and optional-model recovery.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { createJourneyStore, JOURNEY_STORAGE_KEY, } from '../src/journey/progress'
import { BRIDGE_TARGET } from '../src/observatory/encounter'
import { OBSERVATORY_ASSETS } from '../src/observatory/scene'
import type { BrowserContext, Page } from 'playwright'

const out = process.env.VERIFY_OUT_DIR
assert.ok(out, 'Set VERIFY_OUT_DIR to an admitted run evidence directory')
const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
const errors: string[] = []
const captures: unknown[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  status: 'running',
  errors,
  captures,
  nativeHeadsetTested: false,
  fixture:
    'Both pages seeded through the current progress-store API for art inspection. Tideweave is replayed using real pointer input. This script does not re-earn Glasswake.',
  scope:
    'Real-time headed hardware WebGPU; sampled desktop motion and resource stability, not a sustained frame-rate benchmark or headset comfort proof.',
}
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')
const store = createJourneyStore({ worlds: ALMANAC_WORLDS })
store.completeOnboarding()
store.completeWorld('glasswake')
store.completeWorld('tideweave')

function desktop() {
  const get = (name: string): unknown =>
    JSON.parse(execFileSync('hyprctl', ['-j', name], { encoding: 'utf8' }))
  const active = get('activewindow') as { address?: string }
  const workspace = get('activeworkspace') as { id: number }
  const monitors = get('monitors') as {
    id: number
    specialWorkspace: { name: string }
  }[]
  return {
    active: active.address,
    workspace: workspace.id,
    special: monitors.map((monitor) => [
      monitor.id,
      monitor.specialWorkspace.name,
    ]),
  }
}
const foreground = process.env.HYPRLAND_INSTANCE_SIGNATURE
  ? desktop()
  : undefined
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
let currentPage: Page | undefined
const state = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
const encounter = (page: Page) =>
  page.evaluate(() => window.__observatory!.encounter)
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })

async function watch(page: Page, expectedFailures?: unknown[]) {
  currentPage = page
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.detach()
  report.focus =
    'CDP focus emulation keeps this hidden test surface active. This is not native tab-visibility acceptance.'
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (
      expectedFailures &&
      message.type() === 'error' &&
      /503/.test(message.text()) &&
      /tideweave-crossing\.glb/.test(message.location().url)
    ) {
      expectedFailures.push({
        text: message.text(),
        location: message.location(),
      })
    } else if (
      message.type() === 'error' ||
      /computations created outside|GPU validation|device lost/i.test(
        message.text(),
      )
    )
      errors.push(message.text())
  })
}

async function ready(page: Page, expectedAssetError = '') {
  await page.waitForFunction(
    () =>
      window.__observatory?.runtime.snapshot().ready ||
      window.__observatory?.runtime.snapshot().error,
    undefined,
    { timeout: 60000 },
  )
  await page.waitForFunction(
    () =>
      window
        .__observatory!.runtime.snapshot()
        .assets.every(
          (asset) => asset.status === 'ready' || asset.status === 'error',
        ),
    undefined,
    { timeout: 60000 },
  )
  await page.waitForFunction(
    () => {
      const snapshot = window.__observatory!.runtime.snapshot()
      return (
        snapshot.bookDetail.status === 'ready' &&
        snapshot.sceneDetail.status === 'ready' &&
        snapshot.frame.submissions > 3
      )
    },
    undefined,
    { timeout: 60000 },
  )
  const snapshot = await state(page)
  assert.ok(snapshot.ready, snapshot.error)
  assert.ok(!/swiftshader|llvmpipe/i.test(snapshot.adapter), snapshot.adapter)
  assert.deepEqual(snapshot.errors, [])
  assert.equal(snapshot.frame.generations, 2)
  assert.ok(
    snapshot.assets.every((asset) =>
      asset.id === expectedAssetError
        ? asset.status === 'error'
        : asset.status === 'ready',
    ),
    JSON.stringify(snapshot.assets),
  )
}

async function frames(page: Page, count = 3) {
  const start = (await state(page)).frame.submissions
  await page.waitForFunction(
    (target) =>
      window.__observatory!.runtime.snapshot().frame.submissions >= target,
    start + count,
    { timeout: 30000 },
  )
}

async function move(page: Page, point: readonly [number, number], steps = 1) {
  const projected = await page.evaluate(
    (target) => window.__observatory!.runtime.projectTrace(target),
    point,
  )
  assert.ok(projected.visible, JSON.stringify(projected))
  const canvas = await page.locator('canvas').boundingBox()
  assert.ok(canvas)
  await page.mouse.move(
    canvas.x + projected.x * canvas.width,
    canvas.y + projected.y * canvas.height,
    { steps },
  )
}

async function crossing(page: Page) {
  report.step = 'select-tideweave'
  await button(page, 'Tideweave').click()
  report.step = 'open-crossing'
  await button(page, 'Play again').click()
  report.step = 'stop-phrase'
  if (await button(page, 'Stop phrase').isVisible())
    await button(page, 'Stop phrase').click()
  report.step = 'trace-without-sound'
  await button(page, 'Trace without sound').click()
  report.step = 'trace-frames'
  await frames(page)
  assert.equal((await state(page)).view, 'trace')
  assert.equal((await encounter(page)).accepted, 0)
}

async function tracePart(page: Page, from: number, through: number) {
  await move(page, BRIDGE_TARGET[from])
  await page.mouse.down()
  for (let index = from + 1; index <= through; index++)
    await move(page, BRIDGE_TARGET[index], 28)
  await page.mouse.up()
  await frames(page)
  assert.equal((await encounter(page)).accepted, through + 1)
}

async function capture(
  page: Page,
  name: string,
  width = 1440,
  height = 950,
  clay = false,
) {
  await page.setViewportSize({ width, height })
  await page.evaluate((value) => {
    window.__observatory!.runtime.setClay(value)
  }, clay)
  await frames(page)
  const snapshot = await state(page)
  const layout = await page.evaluate(() => {
    const bounds = document.querySelector('canvas')!.getBoundingClientRect()
    const bottom = document
      .querySelector('.observatory-bottom')!
      .getBoundingClientRect()
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      anchors: window
        .__observatory!.runtime.snapshot()
        .traceAnchors.map((point) => ({
          visible: point.visible,
          x: bounds.left + point.x * bounds.width,
          y: bounds.top + point.y * bounds.height,
        })),
      bottomTop: bottom.top,
    }
  })
  assert.equal(layout.overflow, false)
  assert.ok(
    layout.anchors.every(
      (point) =>
        point.visible &&
        point.y < layout.bottomTop - 12 &&
        point.x > 0 &&
        point.x < width,
    ),
    JSON.stringify(layout),
  )
  assert.deepEqual(snapshot.errors, [])
  await page.screenshot({ path: path.join(out!, `${name}.png`) })
  captures.push({ name, width, height, clay, layout, snapshot })
}

function resources(snapshot: Awaited<ReturnType<typeof state>>) {
  return {
    bufferBytes: snapshot.frame.bufferBytes,
    generations: snapshot.frame.generations,
    livePoints: snapshot.frame.livePoints,
    drawCalls: snapshot.frame.drawCalls,
    triangles: snapshot.frame.triangles,
    bookDetail: snapshot.bookDetail,
    sceneDetail: snapshot.sceneDetail,
  }
}

async function sampledIdentity(page: Page) {
  return page.evaluate(async () => {
    const hashes: Record<string, string> = {}
    for (const id of ['glasswake', 'tideweave'] as const) {
      const points = await window.__observatory!.runtime.readPoints(id, 256)
      const digest = await window.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(points)),
      )
      hashes[id] = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('')
    }
    return hashes
  })
}

async function placement() {
  if (!foreground) return
  const cdp = await browser.newBrowserCDPSession()
  const processes = await cdp.send('SystemInfo.getProcessInfo')
  const pid = processes.processInfo.find(
    (entry) => entry.type === 'browser',
  )?.id
  await cdp.detach()
  assert.ok(pid)
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
    JSON.stringify(owned),
  )
  const current = desktop()
  assert.deepEqual(current.special, foreground.special)
  assert.equal(current.workspace, foreground.workspace)
  assert.equal(current.active, foreground.active)
  report.placement = { hiddenAgentWorkspace: true, foregroundUnchanged: true }
}

async function verifyGrowth(context: BrowserContext) {
  const page = await context.newPage()
  await watch(page)
  report.step = 'growth-ready'
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await ready(page)
  await placement()
  report.initial = await state(page)
  report.step = 'growth-identity'
  const identity = await sampledIdentity(page)
  await crossing(page)
  report.step = 'growth-captures'
  await capture(page, 'tideweave-unearned-material')
  await capture(page, 'tideweave-unearned-clay', 1440, 950, true)
  await page.evaluate(() => {
    window.__observatory!.runtime.setClay(false)
  })
  await move(page, BRIDGE_TARGET[2])
  await page.mouse.down()
  await page.mouse.up()
  assert.equal((await encounter(page)).accepted, 0)
  await tracePart(page, 0, 1)
  assert.equal((await state(page)).visual.bridgeProgress, 2.5)
  await capture(page, 'tideweave-partial-material')
  await tracePart(page, 1, 3)
  assert.equal((await state(page)).visual.bridgeProgress, 5)
  await delay(1200)
  await capture(page, 'tideweave-complete-material')
  await capture(page, 'tideweave-complete-clay', 1440, 950, true)
  await capture(page, 'tideweave-complete-portrait', 390, 844)
  await capture(page, 'tideweave-complete-landscape', 844, 390)
  await page.setViewportSize({ width: 1440, height: 950 })
  await frames(page)
  const stable = resources(await state(page))
  assert.deepEqual(await sampledIdentity(page), identity)
  await page.evaluate(() => {
    window.__observatory!.runtime.setMotion(true)
  })
  const movingStart = await state(page)
  const samples: unknown[] = []
  for (let sample = 0; sample < 3; sample++) {
    await delay(850)
    const snapshot = await state(page)
    assert.deepEqual(resources(snapshot), stable)
    samples.push(snapshot)
    await page.locator('canvas').screenshot({
      path: path.join(out!, `tideweave-motion-${sample + 1}.png`),
    })
  }
  const movingEnd = await state(page)
  assert.ok(movingEnd.visual.time > movingStart.visual.time)
  assert.ok(movingEnd.frame.submissions > movingStart.frame.submissions)
  await page.evaluate(() => {
    window.__observatory!.runtime.setMotion(false)
  })
  await frames(page)
  const pausedStart = await state(page)
  const first = await page
    .locator('canvas')
    .screenshot({ path: path.join(out!, 'tideweave-paused-a.png') })
  await delay(1000)
  const pausedEnd = await state(page)
  const second = await page
    .locator('canvas')
    .screenshot({ path: path.join(out!, 'tideweave-paused-b.png') })
  assert.equal(pausedStart.visual.time, pausedEnd.visual.time)
  assert.deepEqual(resources(pausedEnd), stable)
  assert.equal(
    hash(first),
    hash(second),
    'Paused canvas must remain pixel-identical after completion',
  )
  assert.deepEqual(await sampledIdentity(page), identity)
  report.growth = {
    skippedStartRejected: true,
    realPointerCompleted: true,
    partialLiftRejoined: true,
    reducedMotionSnapsToEarned: true,
    sampledIdentity: identity,
  }
  report.motion = {
    durationNote:
      'Three samples separated by 850ms in real time; continued motion, stable resources, then 1s paused canvas equality. This is not sustained performance or a subjective shimmer guarantee.',
    movingStart,
    samples,
    movingEnd,
    pausedStart,
    pausedEnd,
    pausedCanvasHash: hash(first),
  }
  await page.close()
}

async function verifyRecovery(context: BrowserContext) {
  const page = await context.newPage()
  const expectedFailures: unknown[] = []
  await watch(page, expectedFailures)
  report.step = 'recovery-ready'
  let failedRequests = 0
  await page.route(
    '**/models/observatory/tideweave-crossing.glb',
    async (route) => {
      failedRequests++
      await route.fulfill({
        status: 503,
        body: 'Deliberate optional-model verification failure',
      })
    },
  )
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await ready(page, 'tideweave-crossing')
  await crossing(page)
  await tracePart(page, 0, 0)
  assert.equal((await state(page)).visual.bridgeProgress, 1.25)
  await capture(page, 'tideweave-model-fallback')
  const fallback = await state(page)
  assert.equal(failedRequests, 1)
  await page.unroute('**/models/observatory/tideweave-crossing.glb')
  await button(page, 'Retry objects').click()
  await ready(page)
  assert.equal((await encounter(page)).accepted, 1)
  await frames(page)
  const recovered = await state(page)
  await capture(page, 'tideweave-model-recovered')
  for (let retry = 0; retry < 3; retry++) {
    await page.evaluate(() => {
      window.__observatory!.runtime.retryAssets()
    })
    await frames(page)
  }
  const repeated = await state(page)
  assert.deepEqual(resources(repeated), resources(recovered))
  report.recovery = {
    expectedFailures,
    failedRequests,
    actualRetryButton: true,
    fallbackRemainsPlayable: true,
    progressRetainedAfterRetry: true,
    readyRetriesDeduplicated: true,
    fallback,
    recovered,
    repeated,
  }
  await page.close()
}

try {
  await mkdir(out, { recursive: true })
  report.browserVersion = browser.version()
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 950 },
  })
  context.setDefaultTimeout(30000)
  await context.addInitScript(
    ({ key, progress }) => {
      localStorage.setItem(key, JSON.stringify(progress))
    },
    { key: JOURNEY_STORAGE_KEY, progress: store.read().progress },
  )
  const assets: Record<string, unknown> = {}
  for (const asset of OBSERVATORY_ASSETS) {
    const response = await context.request.get(base + asset.url)
    assert.ok(response.ok(), `${asset.id}: HTTP ${response.status()}`)
    const served = await response.body()
    const local = await readFile(
      new URL(`../public${asset.url}`, import.meta.url),
    )
    assert.equal(hash(served), hash(local), asset.id)
    assets[asset.id] = {
      url: asset.url,
      bytes: local.byteLength,
      sha256: hash(local),
    }
  }
  report.servedAssetInventory = {
    note: 'Served bytes match current local files. These hashes alone do not establish comparison with an earlier commit.',
    assets,
  }
  await verifyGrowth(context)
  await verifyRecovery(context)
  assert.deepEqual(errors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  report.failureStack = error instanceof Error ? error.stack : undefined
  if (currentPage && !currentPage.isClosed()) {
    report.lastState = await state(currentPage).catch(() => undefined)
    await currentPage
      .screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 })
      .catch(() => undefined)
  }
  process.exitCode = 1
} finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  await writeFile(
    path.join(out, 'tideweave-stage.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
}
