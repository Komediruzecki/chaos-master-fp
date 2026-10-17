// Standalone headed hardware proof. Output must be an explicitly allocated evidence directory.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { BRIDGE_TARGET } from '../src/observatory/encounter'
import { OBSERVATORY_ASSETS } from '../src/observatory/scene'
import type { Page } from 'playwright'
import type * as ObservatoryGpuHarness from '../tests/observatoryGpuHarness'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
assert.ok(
  process.env.VERIFY_OUT_DIR,
  'Set VERIFY_OUT_DIR to allocated evidence storage',
)
const out = path.resolve(process.env.VERIFY_OUT_DIR)
await mkdir(out, { recursive: true })
const errors: string[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  nativeHeadsetTested: false,
}
const desktop = () => {
  const get = (name: string) =>
    JSON.parse(execFileSync('hyprctl', ['-j', name], { encoding: 'utf8' }))
  return {
    active: get('activewindow').address,
    workspace: get('activeworkspace').id,
    special: get('monitors').map(
      (m: { id: number; specialWorkspace: { name: string } }) => [
        m.id,
        m.specialWorkspace.name,
      ],
    ),
    clients: get('clients').map(
      (c: { address: string; class: string; workspace: { name: string } }) => ({
        address: c.address,
        class: c.class,
        workspace: c.workspace.name,
      }),
    ),
  }
}
const before = desktop()
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
    ...(process.env.VERIFY_X11 === '1' ? ['--ozone-platform=x11'] : []),
  ],
})
const checkPlacement = () => {
  const current = desktop()
  const owned = current.clients.filter(
    (c: { address: string }) =>
      !before.clients.some((b: { address: string }) => b.address === c.address),
  )
  assert.ok(owned.length > 0)
  assert.ok(
    owned.every(
      (c: { class: string; workspace: string }) =>
        c.class === 'agent-browser' && c.workspace === 'special:agents',
    ),
  )
  assert.equal(current.active, before.active)
  assert.equal(current.workspace, before.workspace)
  assert.deepEqual(current.special, before.special)
  report.browserPlacement = {
    hiddenAgentWorkspace: true,
    foregroundUnchanged: true,
  }
}
const state = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
const audio = (page: Page) =>
  page.evaluate(() => window.__observatory!.audio.snapshot())
const encounter = (page: Page) =>
  page.evaluate(() => window.__observatory!.encounter)
const fingerprints = (page: Page) =>
  page.evaluate(async () => {
    const hashes: Record<string, string> = {}
    for (const id of ['glasswake', 'tideweave'] as const) {
      const points = await window.__observatory!.runtime.readPoints(id, 131072)
      const bytes = new Float32Array(points!.flat())
      const digest = await window.crypto.subtle.digest('SHA-256', bytes)
      hashes[id] = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
    }
    return hashes
  })
const frames = async (page: Page, n = 2) => {
  const start = (await state(page)).frame.submissions
  await page.waitForFunction(
    (target) =>
      window.__observatory!.runtime.snapshot().frame.submissions >= target,
    start + n,
    { timeout: 30000 },
  )
}
const ready = async (page: Page) => {
  await page.waitForFunction(
    () =>
      window.__observatory?.runtime.snapshot().ready ||
      window.__observatory?.runtime.snapshot().error,
    undefined,
    { timeout: 60000 },
  )
  assert.equal((await state(page)).ready, true, (await state(page)).error)
  await page.waitForFunction(() =>
    window
      .__observatory!.runtime.snapshot()
      .assets.every((a) => a.status === 'ready' || a.status === 'error'),
  )
  await frames(page)
}
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const capture = async (page: Page, name: string) => {
  await frames(page)
  await page.screenshot({ path: path.join(out, `${name}.png`) })
}
const move = async (
  page: Page,
  point: readonly [number, number],
  steps = 1,
) => {
  const p = await page.evaluate(
    (p) => window.__observatory!.runtime.projectTrace(p),
    point,
  )
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + p.x * box.width, box.y + p.y * box.height, {
    steps,
  })
}
try {
  report.browserVersion = browser.version()
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: true,
    viewport: { width: 1440, height: 950 },
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text())
  })
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await ready(page)
  checkPlacement()
  const initial = await state(page)
  assert.ok(!/swiftshader|llvmpipe/i.test(initial.adapter), initial.adapter)
  assert.ok(initial.assets.every((a) => a.status === 'ready'))
  assert.equal(initial.frame.generations, 2)
  report.initial = initial
  report.sharedDepth = await page.evaluate(async () => {
    const modulePath = '/tests/observatoryGpuHarness.ts'
    const harness = (await import(modulePath)) as typeof ObservatoryGpuHarness
    return harness.verifyObservatoryDepth()
  })
  const hashes: Record<string, string> = {}
  for (const asset of OBSERVATORY_ASSETS) {
    const delivered = await (await context.request.get(base + asset.url)).body()
    const local = await readFile(
      new URL(`../public${asset.url}`, import.meta.url),
    )
    const hash = (bytes: Uint8Array) =>
      createHash('sha256').update(bytes).digest('hex')
    assert.equal(hash(delivered), hash(local))
    hashes[asset.id] = hash(delivered)
  }
  report.runtimeAssetHashes = hashes
  const identity = await fingerprints(page)
  report.pointBufferHashes = identity
  await capture(page, '01-overview')
  await button(page, 'Hear this world').click()
  await page.waitForFunction(
    () => window.__observatory!.audio.snapshot().level > 0.001,
  )
  report.audioSignal = await audio(page)
  await frames(page, 3)
  assert.deepEqual(await fingerprints(page), identity)
  await button(page, 'Tideweave').click()
  assert.equal((await audio(page)).playing, false)
  assert.equal((await state(page)).selectedWorld, 'tideweave')
  await button(page, 'Inspect orb').click()
  await capture(page, '02-inspect-tideweave')
  await button(page, 'Widen view').click()
  await button(page, 'Pause motion').click()
  await frames(page)
  const frozen = (await state(page)).visual
  await page.waitForTimeout(500)
  await frames(page)
  assert.deepEqual((await state(page)).visual, frozen)
  assert.deepEqual(await fingerprints(page), identity)
  assert.equal((await state(page)).frame.generations, 2)
  report.retainedSamplesAndPause = true
  console.info(
    'Asset delivery, audio, retained identity and motion pause passed',
  )
  await button(page, 'Trace a melody').click()
  await page.waitForFunction(
    () => window.__observatory!.exerciseStage === 'answer',
    undefined,
    { timeout: 15000 },
  )
  await frames(page)
  assert.ok(
    await page
      .getByText('Guided tracing. No pitch or rhythm score.')
      .isVisible(),
  )
  await capture(page, '03-bridge-guided')
  // A later note cannot start; neither can a jump from the first to the last.
  await move(page, BRIDGE_TARGET[2])
  await page.mouse.down()
  await page.mouse.up()
  assert.equal((await encounter(page)).accepted, 0)
  await move(page, BRIDGE_TARGET[0])
  await page.mouse.down()
  await move(page, BRIDGE_TARGET[3])
  await page.mouse.up()
  assert.equal((await encounter(page)).accepted, 1)
  // A genuine continuous pointer trace earns two notes, survives a lift, and resumes.
  await move(page, BRIDGE_TARGET[0])
  await page.mouse.down()
  await move(page, BRIDGE_TARGET[1], 20)
  await page.mouse.up()
  assert.equal((await encounter(page)).accepted, 2)
  await capture(page, '04-bridge-half')
  await move(page, BRIDGE_TARGET[1])
  await page.mouse.down()
  await move(page, BRIDGE_TARGET[2], 24)
  await move(page, BRIDGE_TARGET[3], 24)
  await page.mouse.up()
  assert.equal((await encounter(page)).accepted, 4)
  await frames(page)
  assert.equal((await state(page)).visual.bridgeProgress, 5)
  await capture(page, '05-bridge-complete')
  report.pointer = {
    skippedStartRejected: true,
    jumpRejected: true,
    retryPreservesProgress: true,
    completed: true,
  }
  console.info('Pointer completion and retry passed')
  // Drive the same judge with actual key events. No state injection or completion hook.
  await button(page, 'Start again').click()
  await button(page, 'Use keyboard').click()
  // A hidden compositor schedules rAF at roughly 1 Hz here. Controlled frame time
  // proves actual keyboard input without claiming foreground/GPU performance.
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  report.keyboardClock =
    'Controlled 32 ms frames; real key events and real WebGPU'
  await page.keyboard.press('Enter')
  assert.equal((await encounter(page)).accepted, 1)
  for (const target of BRIDGE_TARGET.slice(1)) {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const cursor = await page
        .locator('.observatory-keyboard-cursor')
        .boundingBox()
      assert.ok(cursor)
      const projected = await page.evaluate(
        (p) => window.__observatory!.runtime.projectTrace(p),
        target,
      )
      const box = (await page.locator('canvas').boundingBox())!
      const dx = projected.x * box.width + box.x - (cursor.x + cursor.width / 2)
      const dy =
        projected.y * box.height + box.y - (cursor.y + cursor.height / 2)
      if (Math.hypot(dx, dy) < 7 || (await encounter(page)).accepted === 4)
        break
      const keys = [
        Math.abs(dx) > 4 ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : '',
        Math.abs(dy) > 4 ? (dy > 0 ? 'ArrowDown' : 'ArrowUp') : '',
      ].filter(Boolean)
      for (const key of keys) await page.keyboard.down(key)
      await page.clock.runFor(32)
      for (const key of keys) await page.keyboard.up(key)
      assert.equal(
        (await encounter(page)).drawing ||
          (await encounter(page)).accepted === 4,
        true,
        JSON.stringify(await encounter(page)),
      )
    }
  }
  assert.equal(
    (await encounter(page)).accepted,
    4,
    'Actual keyboard trace must complete',
  )
  await page.clock.resume()
  report.keyboard = { completed: true }
  console.info('Keyboard completion passed')
  await button(page, 'Return to worlds').click()
  await button(page, 'Hear this world').click()
  await page.waitForFunction(
    () => window.__observatory!.audio.snapshot().playing,
  )
  const cover = await context.newPage()
  await cover.goto('about:blank')
  await cover.bringToFront()
  // Playwright enables focus emulation by default, keeping background tabs visible.
  // Restore Chromium's native visibility while a second tab is in front.
  const visibilitySession = await context.newCDPSession(page)
  await visibilitySession.send('Emulation.setFocusEmulationEnabled', {
    enabled: false,
  })
  const nativeHidden = await page
    .waitForFunction(() => document.hidden, undefined, {
      timeout: 3000,
      // Native hidden documents stop RAF; poll using a timer.
      polling: 100,
    })
    .then(
      () => true,
      () => false,
    )
  report.nativeVisibility = {
    observedHidden: nativeHidden,
    limitation: nativeHidden
      ? null
      : 'The hidden automation surface keeps background documents visible. Native tab-hide behavior remains unverified.',
  }
  if (!nativeHidden) {
    // Explicit simulation tests our handlers without claiming native browser behavior.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  assert.equal((await audio(page)).playing, false)
  assert.equal((await audio(page)).progress, 0)
  assert.equal((await state(page)).active, false)
  if (!nativeHidden) {
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  await visibilitySession.send('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  })
  await visibilitySession.detach()
  await cover.close()
  await page.bringToFront()
  assert.equal((await state(page)).active, true)
  assert.equal((await audio(page)).playing, false)
  report.visibilityHandlers = {
    audioStopped: true,
    renderSuspended: true,
    deliberateAudioResume: true,
    method: nativeHidden ? 'native' : 'simulated visibility event',
  }
  assert.deepEqual(await fingerprints(page), identity)
  for (const size of [
    { width: 820, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    await button(page, 'Trace a melody').click()
    if (await button(page, 'Stop phrase').isVisible())
      await button(page, 'Stop phrase').click()
    await button(page, 'Trace without sound').click()
    await frames(page)
    const layout = await page.evaluate(() => {
      const bottom = document
        .querySelector('.observatory-bottom')!
        .getBoundingClientRect()
      const canvas = document.querySelector('canvas')!.getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        height: canvas.height,
        bottomTop: bottom.top,
        targets: window
          .__observatory!.runtime.snapshot()
          .traceAnchors.map((p) => ({
            x: canvas.left + p.x * canvas.width,
            y: canvas.top + p.y * canvas.height,
            visible: p.visible,
          })),
        buttons: Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            '.observatory-bottom button',
          ),
        ).map((b) => ({
          text: b.textContent,
          ...b.getBoundingClientRect().toJSON(),
        })),
      }
    })
    assert.equal(layout.overflow, false)
    assert.equal(layout.height, size.height)
    assert.ok(
      layout.targets.every((p) => p.visible && p.y < layout.bottomTop - 12),
      JSON.stringify(layout),
    )
    assert.ok(
      layout.buttons.every(
        (b) =>
          b.bottom <= size.height + 1 &&
          b.right <= size.width + 1 &&
          b.left >= -1,
      ),
    )
    report[`layout${size.width}x${size.height}`] = layout
    await capture(page, `layout-${size.width}x${size.height}`)
    await button(page, 'Return to worlds').click()
  }
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal((await state(page)).motion, false)
  await page.evaluate(() => {
    window.__observatory!.runtime.setClay(true)
  })
  await capture(page, '06-clay')
  await page.evaluate(() => {
    window.__observatory!.runtime.setClay(false)
  })
  report.final = await state(page)
  assert.deepEqual(errors, [])
  report.errors = errors
  // Expected failures get a separate page and report, so genuine console errors cannot hide.
  const fault = await context.newPage()
  let rejectBridge = true
  await fault.route(
    '**/models/observatory/bridge-segment.glb',
    async (route) => {
      if (rejectBridge)
        await route.fulfill({
          status: 503,
          body: 'Deliberate verification failure',
        })
      else await route.continue()
    },
  )
  await fault.goto(`${base}/observatory`)
  await ready(fault)
  assert.deepEqual(await fingerprints(fault), identity)
  report.identityStableAcrossFreshRuntime = true
  assert.equal(
    (await state(fault)).assets.find((a) => a.id === 'bridge')?.status,
    'error',
  )
  rejectBridge = false
  await button(fault, 'Retry objects').click()
  await fault.waitForFunction(() =>
    window
      .__observatory!.runtime.snapshot()
      .assets.every((a) => a.status === 'ready'),
  )
  await fault.evaluate(() => {
    window.__observatory!.runtime.loseDeviceForTest()
  })
  await fault
    .getByRole('heading', { name: 'The observatory could not open' })
    .waitFor()
  report.failureRecovery = { assetRetry: true, deviceLossActionable: true }
  await fault.close()
  checkPlacement()
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.errors = errors
  report.failure = String(error)
  throw error
} finally {
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  await browser.close()
}
console.info(JSON.stringify(report, null, 2))
