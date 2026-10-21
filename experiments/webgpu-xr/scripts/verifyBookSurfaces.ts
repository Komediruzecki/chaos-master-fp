// Matched, hardware-rendered Almanac surface views; optional texture recovery proof.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BOOK_DETAIL_BYTES, BOOK_DETAIL_GPU_BYTES, BOOK_DETAIL_URL, } from '../src/almanac/bookDetailData'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { createJourneyStore, JOURNEY_STORAGE_KEY, } from '../src/journey/progress'
import type { Page } from 'playwright'
import type { BenchSettings } from '../src/bench/settings'

const out = process.env.VERIFY_OUT_DIR
assert.ok(out, 'Set VERIFY_OUT_DIR to a registered agent-out run')
await mkdir(out, { recursive: true })
const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
const phase = process.env.VERIFY_PHASE ?? 'baseline'
const motionOnly = process.env.VERIFY_MOTION_ONLY === '1'
const observatoryOnly = process.env.VERIFY_OBSERVATORY_ONLY === '1'
const store = createJourneyStore({ worlds: ALMANAC_WORLDS })
store.completeOnboarding()
store.completeWorld('glasswake')
store.completeWorld('tideweave')
const progress = store.read().progress
const errors: string[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  phase,
  nativeHeadsetTested: false,
  base,
  errors,
  captureNote:
    'Real-time WebGPU, fixed seed and cameras; orb rotation and audio disabled. No visual source modifications.',
}

function desktopState() {
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
const before = process.env.HYPRLAND_INSTANCE_SIGNATURE
  ? desktopState()
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
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 950 },
  })
  await context.addInitScript(
    ({ key, progress }) => {
      localStorage.setItem(key, JSON.stringify(progress))
    },
    { key: JOURNEY_STORAGE_KEY, progress },
  )
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /computations created outside/.test(message.text())
    )
      errors.push(message.text())
  })
  assert.equal((await page.goto(`${base}/almanac`))?.status(), 200)
  if (before) {
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
      owned.length > 0 &&
        owned.every(
          (client) =>
            client.class === 'agent-browser' &&
            client.workspace.name === 'special:agents',
        ),
    )
    assert.deepEqual(
      desktopState(),
      before,
      'Browser must not change foreground or reveal the agent workspace',
    )
    report.browserPlacement = {
      hiddenAgentWorkspace: true,
      foregroundUnchanged: true,
    }
  }
  await page.waitForFunction(
    () => {
      const state = window.__almanac?.runtime.snapshot()
      return (
        state?.book.reliefStatus === 'ready' ||
        state?.book.status === 'error' ||
        Boolean(state?.error)
      )
    },
    undefined,
    { timeout: 60000 },
  )
  const startup = await page.evaluate(() =>
    window.__almanac!.runtime.snapshot(),
  )
  report.startup = startup
  assert.ok(startup.ready, startup.error)
  assert.equal(startup.book.status, 'ready', startup.book.error)
  assert.equal(startup.book.reliefStatus, 'ready', startup.book.reliefError)
  if (phase !== 'baseline') {
    await page.waitForFunction(
      () =>
        ['ready', 'error'].includes(
          window.__almanac?.runtime.snapshot().book.detail.status ?? '',
        ) || Boolean(window.__almanac?.runtime.snapshot().error),
      undefined,
      { timeout: 60000 },
    )
  }
  const initial = await page.evaluate(() =>
    window.__almanac!.runtime.snapshot(),
  )
  report.initial = initial
  assert.ok(initial.ready, initial.error)
  if (phase !== 'baseline')
    assert.equal(initial.book.detail.status, 'ready', initial.book.detail.error)
  assert.ok(!/swiftshader|llvmpipe/i.test(initial.adapter))
  assert.deepEqual(initial.book.awards, { glasswake: true, tideweave: true })
  assert.equal(initial.book.draws, 3)
  report.initial = initial
  const captures: unknown[] = []

  async function capture(
    name: string,
    width: number,
    height: number,
    patch: Partial<BenchSettings>,
    clay = false,
  ) {
    await page.setViewportSize({ width, height })
    await page.evaluate(
      ({ patch, clay }) => {
        const runtime = window.__almanac!.runtime
        runtime.setActive(true)
        runtime.setBookInspection(false)
        runtime.setBookDock('left')
        runtime.setBookClay(clay)
        runtime.setSettings({
          yaw: 0,
          pitch: 0,
          distance: 3,
          rotation: false,
          seed: 73129,
          stars: true,
          ...patch,
        })
      },
      { patch, clay },
    )
    const start = await page.evaluate(
      () => window.__almanac!.runtime.snapshot().submissions ?? 0,
    )
    await page.waitForFunction(
      (target) =>
        (window.__almanac!.runtime.snapshot().submissions ?? 0) >= target,
      start + 6,
    )
    const snapshot = await page.evaluate(() =>
      window.__almanac!.runtime.snapshot(),
    )
    assert.ok(snapshot.ready, snapshot.error)
    assert.deepEqual(snapshot.errors, [])
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    )
    await page.screenshot({
      path: path.join(out!, `${name}.png`),
      fullPage: true,
    })
    captures.push({
      name,
      width,
      height,
      settings: snapshot.settings,
      book: snapshot.book,
      bufferBytes: snapshot.bufferBytes,
      generation: snapshot.generation,
    })
  }
  if (!motionOnly && !observatoryOnly) {
    await capture('book-material-1440', 1440, 950, {})
    await capture('book-clay-1440', 1440, 950, {}, true)
    await capture('paper-relief-close-1440', 1440, 950, {
      pitch: 30,
      distance: 1.4,
    })
    await capture('leather-back-1440', 1440, 950, {
      yaw: 180,
      pitch: -80,
      distance: 2.2,
    })
    await capture('metal-grazing-1440', 1440, 950, {
      yaw: 50,
      pitch: -20,
      distance: 1.8,
    })
    await capture('book-material-390', 390, 844, {})
    await capture('book-clay-390', 390, 844, {}, true)
  }
  report.captures = captures
  if (motionOnly) {
    const canvas = page.locator('canvas')
    await page.evaluate(() => {
      window.__almanac!.runtime.resetView()
    })
    const rendered = async () => {
      const before = await page.evaluate(
        () => window.__almanac!.runtime.snapshot().submissions ?? 0,
      )
      await page.waitForFunction(
        (target) =>
          (window.__almanac!.runtime.snapshot().submissions ?? 0) >= target,
        before + 3,
      )
    }
    await rendered()
    const fixedBefore = await canvas.screenshot()
    const bounds = await canvas.boundingBox()
    assert.ok(bounds)
    const x = bounds.x + bounds.width * 0.5
    const y = bounds.y + bounds.height * 0.48
    const frames: unknown[] = []
    const hitTarget = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      { x, y },
    )
    assert.equal(
      hitTarget,
      'CANVAS',
      'Orbit gestures must hit the actual canvas',
    )
    report.motionFrames = frames
    for (let step = 1; step <= 4; step++) {
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 45, y + 10, { steps: 5 })
      await page.mouse.up()
      await rendered()
      const state = await page.evaluate(() =>
        window.__almanac!.runtime.snapshot(),
      )
      assert.ok(state.ready, state.error)
      assert.deepEqual(state.errors, [])
      assert.ok(
        Math.abs(state.settings.yaw) >= step * 14,
        'Each completed pointer gesture must orbit the book',
      )
      await canvas.screenshot({
        path: path.join(out, `motion-orbit-${step}.png`),
      })
      frames.push({
        step,
        settings: state.settings,
        submissions: state.submissions,
      })
    }
    for (let step = 0; step < 8; step++) await page.mouse.wheel(0, 100)
    await rendered()
    const far = await page.evaluate(() => window.__almanac!.runtime.snapshot())
    await canvas.screenshot({ path: path.join(out, 'motion-zoom-far.png') })
    for (let step = 0; step < 12; step++) await page.mouse.wheel(0, -100)
    await rendered()
    const near = await page.evaluate(() => window.__almanac!.runtime.snapshot())
    await canvas.screenshot({ path: path.join(out, 'motion-zoom-near.png') })
    assert.ok(far.settings.distance > initial.settings.distance)
    assert.ok(near.settings.distance < far.settings.distance)
    assert.notEqual(near.settings.yaw, initial.settings.yaw)
    assert.equal(near.generation, initial.generation)
    assert.equal(near.bufferBytes, initial.bufferBytes)
    assert.deepEqual(near.book.detail, initial.book.detail)
    await page.evaluate(() => {
      window.__almanac!.runtime.resetView()
    })
    await rendered()
    await canvas.evaluate((element) => {
      element.blur()
    })
    const fixedAfter = await canvas.screenshot({
      path: path.join(out, 'motion-return-to-fixed.png'),
    })
    assert.ok(
      fixedBefore.equals(fixedAfter),
      'The fixed camera must return to identical book pixels after orbit and zoom',
    )
    report.motion = {
      actualPointerAndWheel: true,
      hitTarget,
      sampledFrames: frames,
      far: far.settings,
      near: near.settings,
      returnedToIdenticalPixels: true,
      noResamplingOrAllocationGrowth: true,
      limitation:
        'Sampled motion frames and runtime state, not a motion recording or headset comfort evaluation.',
    }
  }
  if (phase !== 'baseline' && !motionOnly && !observatoryOnly) {
    const detail = initial.book.detail
    assert.equal(detail.textureBytes, BOOK_DETAIL_GPU_BYTES)
    assert.equal(detail.downloadBytes, BOOK_DETAIL_BYTES)
    assert.equal(detail.textureCount, 1)
    assert.equal(detail.mipCount, 10)
    assert.equal(detail.uploads, 1)
    await page.evaluate(() => {
      window.__almanac!.runtime.retryBook()
    })
    await page.waitForFunction(
      () => window.__almanac!.runtime.snapshot().book.reliefStatus === 'ready',
    )
    const retried = await page.evaluate(() =>
      window.__almanac!.runtime.snapshot(),
    )
    assert.deepEqual(retried.book.detail, detail)
    assert.equal(retried.bufferBytes, initial.bufferBytes)
    assert.equal(retried.generation, initial.generation)
    await page.reload()
    await page.waitForFunction(
      () =>
        window.__almanac?.runtime.snapshot().book.detail.status === 'ready' &&
        window.__almanac.runtime.snapshot().book.reliefStatus === 'ready',
      undefined,
      { timeout: 60000 },
    )
    assert.deepEqual(
      (await page.evaluate(() => window.__almanac!.runtime.snapshot())).book
        .detail,
      detail,
    )
    report.readyRetryAndReload = {
      readyRetryDoesNotReuploadTexture: true,
      reloadReturnsOneCompleteTexture: true,
    }
    await page.close()

    const expectedFailures: string[] = []
    const watch = (target: Page, allow404 = false) => {
      target.on('pageerror', (error) => errors.push(String(error)))
      target.on('console', (message) => {
        if (
          message.type() !== 'error' &&
          !/computations created outside/.test(message.text())
        )
          return
        if (
          allow404 &&
          message.location().url.endsWith(BOOK_DETAIL_URL) &&
          /404/.test(message.text())
        )
          expectedFailures.push(message.text())
        else errors.push(message.text())
      })
    }
    const failed = await context.newPage()
    watch(failed, true)
    await failed.route(`**${BOOK_DETAIL_URL}`, (route) =>
      route.fulfill({ status: 404, body: 'Texture recovery probe' }),
    )
    await failed.goto(`${base}/almanac`)
    await failed.waitForFunction(
      () =>
        window.__almanac?.runtime.snapshot().book.detail.status === 'error' &&
        window.__almanac.runtime.snapshot().book.reliefStatus === 'ready',
      undefined,
      { timeout: 60000 },
    )
    const fallback = await failed.evaluate(() =>
      window.__almanac!.runtime.snapshot(),
    )
    assert.ok(fallback.ready, fallback.error)
    assert.equal(fallback.book.status, 'ready')
    assert.equal(fallback.book.draws, 3)
    assert.equal(fallback.book.detail.textureBytes, 12)
    assert.equal(fallback.book.detail.textureCount, 1)
    assert.equal(fallback.book.detail.uploads, 0)
    assert.deepEqual(fallback.errors, [])
    await failed.screenshot({
      path: path.join(out, 'texture-404-fallback.png'),
      fullPage: true,
    })
    await failed.unroute(`**${BOOK_DETAIL_URL}`)
    await failed.getByRole('button', { name: 'Retry page details' }).click()
    await failed.waitForFunction(
      () =>
        window.__almanac!.runtime.snapshot().book.detail.status === 'ready' &&
        window.__almanac!.runtime.snapshot().book.reliefStatus === 'ready',
      undefined,
      { timeout: 60000 },
    )
    const recovered = await failed.evaluate(() =>
      window.__almanac!.runtime.snapshot(),
    )
    assert.deepEqual(recovered.book.detail, detail)
    assert.equal(recovered.book.draws, 3)
    assert.equal(recovered.generation, fallback.generation)
    assert.equal(recovered.bufferBytes, fallback.bufferBytes)
    assert.deepEqual(recovered.errors, [])
    report.failureAndRecovery = {
      fallback: fallback.book,
      recovered: recovered.book,
      expectedFailures,
    }
    await failed.close()

    const late = await context.newPage()
    watch(late)
    await late.addInitScript(() => {
      const host = window as Window & {
        GPUDevice: { prototype: GPUDevice }
        __surfaceTextureProbe?: { created: number; destroyed: number }
      }
      const counters = { created: 0, destroyed: 0 }
      host.__surfaceTextureProbe = counters
      const create = Reflect.get(host.GPUDevice.prototype, 'createTexture')
      host.GPUDevice.prototype.createTexture = function (descriptor) {
        const texture = create.call(this, descriptor)
        counters.created++
        const destroy = texture.destroy.bind(texture)
        let dead = false
        texture.destroy = () => {
          if (!dead) {
            counters.destroyed++
            dead = true
          }
          destroy()
        }
        return texture
      }
    })
    let release: () => void = () => undefined
    let arrived: () => void = () => undefined
    let handled: () => void = () => undefined
    const fulfilled = new Promise<void>((resolve) => {
      handled = resolve
    })
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const requested = new Promise<void>((resolve) => {
      arrived = resolve
    })
    const bundle = await readFile(
      new URL(
        '../public/models/almanac/surfaces/almanac-surfaces-v1.bin',
        import.meta.url,
      ),
    )
    let lateRouteResult = 'not released'
    await late.route(`**${BOOK_DETAIL_URL}`, async (route) => {
      arrived()
      await waiting
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: bundle,
        })
        lateRouteResult = 'delayed response delivered after disposal'
      } catch (error) {
        lateRouteResult = `request aborted before fulfillment: ${String(error)}`
      } finally {
        handled()
      }
    })
    await late.goto(`${base}/almanac`)
    await requested
    await late.waitForFunction(
      () =>
        window.__almanac?.runtime.snapshot().book.reliefStatus === 'ready' &&
        window.__almanac.runtime.snapshot().book.detail.status === 'loading',
      undefined,
      { timeout: 60000 },
    )
    assert.equal(
      (await late.evaluate(() => window.__almanac!.runtime.snapshot())).book
        .draws,
      3,
    )
    const beforeDispose = await late.evaluate(
      () =>
        (
          window as Window & {
            __surfaceTextureProbe?: { created: number; destroyed: number }
          }
        ).__surfaceTextureProbe,
    )
    await late.evaluate(() => {
      window.__almanac!.runtime.dispose()
    })
    release()
    await fulfilled
    await late.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              resolve()
            }),
          ),
        ),
    )
    const disposed = await late.evaluate(() =>
      window.__almanac!.runtime.snapshot(),
    )
    const afterDispose = await late.evaluate(
      () =>
        (
          window as Window & {
            __surfaceTextureProbe?: { created: number; destroyed: number }
          }
        ).__surfaceTextureProbe,
    )
    assert.ok(beforeDispose && afterDispose)
    assert.equal(
      afterDispose.created,
      beforeDispose.created,
      'A response after disposal must not allocate a texture',
    )
    assert.equal(
      afterDispose.created,
      afterDispose.destroyed,
      'Disposed runtime must release every explicitly created GPU texture',
    )
    assert.equal(disposed.ready, false)
    assert.equal(disposed.book.detail.textureBytes, 0)
    assert.equal(disposed.book.detail.textureCount, 0)
    assert.deepEqual(disposed.errors, [])
    report.lateDispose = {
      lateRouteResult,
      beforeDispose,
      afterDispose,
      detail: disposed.book.detail,
      ready: disposed.ready,
    }
    await late.close()

    const observatory = await context.newPage()
    watch(observatory)
    await observatory.goto(`${base}/observatory`)
    await observatory.waitForFunction(
      () =>
        window.__observatory?.runtime.snapshot().bookDetail.status ===
          'ready' &&
        window.__observatory.runtime
          .snapshot()
          .assets.every((asset) => asset.status === 'ready'),
      undefined,
      { timeout: 60000 },
    )
    const world = await observatory.evaluate(() =>
      window.__observatory!.runtime.snapshot(),
    )
    assert.ok(world.ready, world.error)
    assert.deepEqual(world.errors, [])
    assert.deepEqual(world.bookDetail, detail)
    report.observatory = {
      adapter: world.adapter,
      bookDetail: world.bookDetail,
      assets: world.assets,
      frame: world.frame,
    }
    await observatory.screenshot({
      path: path.join(out, 'observatory-lectern.png'),
      fullPage: true,
    })
    await observatory.close()
    const worldFailed = await context.newPage()
    watch(worldFailed, true)
    await worldFailed.route(`**${BOOK_DETAIL_URL}`, (route) =>
      route.fulfill({
        status: 404,
        body: 'Observatory texture recovery probe',
      }),
    )
    await worldFailed.goto(`${base}/observatory`)
    await worldFailed.waitForFunction(
      () =>
        window.__observatory?.runtime.snapshot().bookDetail.status ===
          'error' &&
        window.__observatory.runtime
          .snapshot()
          .assets.every((asset) => asset.status === 'ready'),
      undefined,
      { timeout: 60000 },
    )
    const worldFallback = await worldFailed.evaluate(() =>
      window.__observatory!.runtime.snapshot(),
    )
    assert.ok(worldFallback.ready, worldFallback.error)
    assert.equal(worldFallback.bookDetail.textureBytes, 12)
    assert.deepEqual(worldFallback.errors, [])
    await worldFailed.unroute(`**${BOOK_DETAIL_URL}`)
    await worldFailed.getByRole('button', { name: 'Retry objects' }).click()
    await worldFailed.waitForFunction(
      () =>
        window.__observatory!.runtime.snapshot().bookDetail.status === 'ready',
      undefined,
      { timeout: 60000 },
    )
    const worldRecovered = await worldFailed.evaluate(() =>
      window.__observatory!.runtime.snapshot(),
    )
    assert.deepEqual(worldRecovered.bookDetail, detail)
    assert.deepEqual(worldRecovered.errors, [])
    report.observatoryRecovery = {
      fallback: worldFallback.bookDetail,
      recovered: worldRecovered.bookDetail,
      actualRetryButton: true,
    }
    await worldFailed.close()
  }
  if (observatoryOnly) {
    await page.goto(`${base}/observatory`)
    await page.waitForFunction(
      () =>
        window.__observatory?.runtime.snapshot().bookDetail.status ===
          'ready' &&
        window.__observatory.runtime
          .snapshot()
          .assets.every((asset) => asset.status === 'ready'),
      undefined,
      { timeout: 60000 },
    )
    await page.evaluate(() => {
      window.__observatory!.runtime.setMotion(false)
    })
    const beforeFrame = await page.evaluate(
      () => window.__observatory!.runtime.snapshot().frame.submissions,
    )
    await page.waitForFunction(
      (target) =>
        window.__observatory!.runtime.snapshot().frame.submissions >= target,
      beforeFrame + 3,
    )
    const state = await page.evaluate(() =>
      window.__observatory!.runtime.snapshot(),
    )
    assert.ok(state.ready, state.error)
    assert.deepEqual(state.errors, [])
    await page.screenshot({
      path: path.join(out, 'observatory-lectern.png'),
      fullPage: true,
    })
    report.observatoryCapture = state
    await page.close()
  }
  if (!page.isClosed())
    report.final = await page.evaluate(() =>
      window.__almanac!.runtime.snapshot(),
    )
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await writeFile(
    path.join(out, 'book-surfaces.json'),
    JSON.stringify(report, null, 2),
  )
}
console.info(`Book surface proof written to ${out}`)
