// Matched hardware-WebGPU scene materials, reached through journey controls.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { createJourneyStore, JOURNEY_STORAGE_KEY, } from '../src/journey/progress'
import { BRIDGE_TARGET } from '../src/observatory/encounter'
import { SCENE_DETAIL_URL } from '../src/observatory/sceneSurface'
import type { BrowserContext, Page } from 'playwright'

const out = process.env.VERIFY_OUT_DIR
assert.ok(out, 'Set VERIFY_OUT_DIR to registered evidence storage')
await mkdir(out, { recursive: true })
const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
const phase = process.env.VERIFY_PHASE ?? 'baseline'
const verifyDetail = phase !== 'baseline'
const recoveryOnly = process.env.VERIFY_RECOVERY_ONLY === '1'
const motionOnly = process.env.VERIFY_MOTION_ONLY === '1'
const store = createJourneyStore({ worlds: ALMANAC_WORLDS })
store.completeOnboarding()
store.completeWorld('glasswake')
store.completeWorld('tideweave')
const errors: string[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  phase,
  base,
  errors,
  nativeHeadsetTested: false,
  fixture:
    'Both earned pages seeded using current store API for art inspection. This pass replays Tideweave with real keyboard controls and the complete temple score with real audio; it does not re-earn Glasswake.',
  timing:
    'Controlled 32ms RAF after startup; real-time WebAudio; reduced-motion preference disables orbit motion before rendering. This is matched art/functional proof, not frame-rate evidence.',
}

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
const before = process.env.HYPRLAND_INSTANCE_SIGNATURE ? desktop() : undefined
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
let page: Page | undefined
const state = () =>
  page!.evaluate(() => window.__observatory!.runtime.snapshot())

async function advance(milliseconds = 96) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 32)
    await page!.clock.runFor(Math.min(32, milliseconds - elapsed))
}
const button = (name: string) =>
  page!.getByRole('button', { name, exact: true })
const captures: unknown[] = []
report.captures = captures

async function capture(name: string, width = 1440, height = 950, clay = false) {
  await page!.setViewportSize({ width, height })
  await page!.evaluate((clay) => {
    window.__observatory!.runtime.setClay(clay)
  }, clay)
  await advance()
  const snapshot = await state()
  assert.ok(snapshot.ready, snapshot.error)
  assert.deepEqual(snapshot.errors, [])
  assert.equal(snapshot.bookDetail.status, 'ready', snapshot.bookDetail.error)
  assert.equal(snapshot.motion, false)
  if (verifyDetail)
    assert.equal(
      snapshot.sceneDetail.status,
      'ready',
      snapshot.sceneDetail.error,
    )
  assert.equal(
    await page!.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
  )
  await page!.screenshot({
    path: path.join(out!, `${name}.png`),
    fullPage: true,
  })
  captures.push({ name, width, height, snapshot })
}

async function finishBridge() {
  if (await button('Stop phrase').isVisible())
    await button('Stop phrase').click()
  if (await button('Trace without sound').isVisible())
    await button('Trace without sound').click()
  await button('Use keyboard').click()
  await page!.keyboard.press('Enter')
  for (const target of BRIDGE_TARGET.slice(1)) {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const cursor = await page!
        .locator('.observatory-keyboard-cursor')
        .boundingBox()
      const canvas = await page!.locator('canvas').boundingBox()
      assert.ok(cursor && canvas)
      const projected = await page!.evaluate(
        (point) => window.__observatory!.runtime.projectTrace(point),
        target,
      )
      const dx =
        projected.x * canvas.width + canvas.x - cursor.x - cursor.width / 2
      const dy =
        projected.y * canvas.height + canvas.y - cursor.y - cursor.height / 2
      const accepted = await page!.evaluate(
        () => window.__observatory!.encounter.accepted,
      )
      if (Math.hypot(dx, dy) < 7 || accepted === 4) break
      const keys = [
        Math.abs(dx) > 4 ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : '',
        Math.abs(dy) > 4 ? (dy > 0 ? 'ArrowDown' : 'ArrowUp') : '',
      ].filter(Boolean)
      for (const key of keys) await page!.keyboard.down(key)
      await advance(32)
      for (const key of keys) await page!.keyboard.up(key)
    }
  }
  assert.equal(
    await page!.evaluate(() => window.__observatory!.encounter.accepted),
    4,
  )
}

async function verifyMotion(context: BrowserContext) {
  page = await context.newPage()
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /computations created outside/.test(message.text())
    )
      errors.push(message.text())
  })
  await page.clock.install()
  await page.goto(`${base}/observatory`)
  await page.waitForFunction(
    () => {
      const snapshot = window.__observatory?.runtime.snapshot()
      return (
        snapshot?.ready &&
        snapshot.sceneDetail.status === 'ready' &&
        snapshot.bookDetail.status === 'ready' &&
        snapshot.assets.every((asset) => asset.status === 'ready') &&
        snapshot.frame.submissions > 2
      )
    },
    undefined,
    { timeout: 60000 },
  )
  await page.clock.pauseAt(
    new Date((await page.evaluate(() => Date.now())) + 100),
  )
  await capture('overview-camera-fixed-before')
  const beforeMotion = await state()
  await page.locator('canvas').focus()
  const steps = [
    [
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
      'ArrowUp',
      'ArrowUp',
      '+',
      '+',
    ],
    [
      'ArrowLeft',
      'ArrowLeft',
      'ArrowLeft',
      'ArrowLeft',
      'ArrowLeft',
      'ArrowLeft',
      'ArrowLeft',
      'ArrowLeft',
    ],
    ['-', '-', '-', '-', 'ArrowDown', 'ArrowDown'],
  ]
  let previous = beforeMotion
  const observations: unknown[] = []
  for (let index = 0; index < steps.length; index++) {
    for (const key of steps[index]) await page.keyboard.press(key)
    await advance()
    const current = await state()
    assert.notDeepEqual(
      current.traceAnchors,
      previous.traceAnchors,
      'Supported overview keyboard input must change camera projection',
    )
    assert.deepEqual(current.sceneDetail, beforeMotion.sceneDetail)
    assert.deepEqual(current.bookDetail, beforeMotion.bookDetail)
    assert.equal(current.frame.bufferBytes, beforeMotion.frame.bufferBytes)
    assert.equal(current.frame.generations, beforeMotion.frame.generations)
    await capture(`overview-camera-sample-${index + 1}`)
    observations.push({ keys: steps[index], snapshot: current })
    previous = current
  }
  await page.evaluate(() => {
    window.__observatory!.runtime.resetCamera()
    const element = document.activeElement
    if (element instanceof HTMLElement) element.blur()
  })
  await capture('overview-camera-fixed-return')
  const returned = await state()
  assert.deepEqual(returned.traceAnchors, beforeMotion.traceAnchors)
  report.sampledCameraMotion = {
    note: 'Real keyboard orbit and zoom, paused orbital animation, three sampled rendered angles. This does not establish continuous-motion shimmer or headset comfort.',
    before: beforeMotion,
    observations,
    returned,
    noResamplingOrBufferFootprintGrowth: true,
  }
  await page.close()
}

async function verifyRecovery(context: BrowserContext) {
  const expectedFailures: string[] = []
  const watch = (target: Page, allow404 = false) => {
    target.on('pageerror', (error) => errors.push(String(error)))
    target.on('console', (message) => {
      if (
        message.type() === 'error' ||
        /computations created outside/.test(message.text())
      ) {
        if (allow404 && /404 \(Not Found\)/.test(message.text()))
          expectedFailures.push(message.text())
        else errors.push(message.text())
      }
    })
  }
  page = await context.newPage()
  watch(page, true)
  await page.route(`**${SCENE_DETAIL_URL}`, (route) =>
    route.fulfill({ status: 404, body: 'Scene texture recovery probe' }),
  )
  await page.goto(`${base}/observatory`)
  await page.waitForFunction(
    () => {
      const snapshot = window.__observatory?.runtime.snapshot()
      return (
        snapshot?.sceneDetail.status === 'error' &&
        snapshot.bookDetail.status === 'ready' &&
        snapshot.assets.every((asset) => asset.status === 'ready') &&
        snapshot.frame.submissions > 2
      )
    },
    undefined,
    { timeout: 60000 },
  )
  const fallback = await state()
  assert.ok(fallback.ready, fallback.error)
  assert.deepEqual(fallback.errors, [])
  assert.equal(fallback.sceneDetail.textureBytes, 12)
  assert.equal(fallback.sceneDetail.uploads, 0)
  assert.equal(fallback.frame.drawCalls, 13)
  await page.screenshot({
    path: path.join(out!, 'scene-texture-404-fallback.png'),
  })
  await page.unroute(`**${SCENE_DETAIL_URL}`)
  await button('Retry objects').click()
  await page.waitForFunction(
    () => {
      const snapshot = window.__observatory!.runtime.snapshot()
      return (
        snapshot.sceneDetail.status === 'ready' &&
        snapshot.assets.every((asset) => asset.status === 'ready') &&
        snapshot.frame.submissions > 2
      )
    },
    undefined,
    { timeout: 60000 },
  )
  const recovered = await state()
  assert.equal(recovered.sceneDetail.textureBytes, 4194300)
  assert.equal(recovered.sceneDetail.uploads, 1)
  assert.equal(recovered.frame.drawCalls, fallback.frame.drawCalls)
  assert.equal(recovered.frame.triangles, fallback.frame.triangles)
  assert.deepEqual(recovered.errors, [])
  for (let retry = 0; retry < 3; retry++) {
    await page.evaluate(() => {
      window.__observatory!.runtime.retryAssets()
    })
    await page.waitForFunction(
      () =>
        window
          .__observatory!.runtime.snapshot()
          .assets.every((asset) => asset.status === 'ready'),
      undefined,
      { timeout: 60000 },
    )
  }
  const repeated = await state()
  assert.deepEqual(repeated.sceneDetail, recovered.sceneDetail)
  assert.deepEqual(repeated.bookDetail, recovered.bookDetail)
  assert.equal(repeated.frame.bufferBytes, recovered.frame.bufferBytes)
  assert.equal(repeated.frame.generations, recovered.frame.generations)
  report.failureAndRecovery = {
    fallback,
    recovered,
    repeated,
    actualRetryButton: true,
    readyRetryDoesNotReuploadTexture: true,
    expectedFailures,
  }
  await page.close()

  page = await context.newPage()
  watch(page)
  await page.addInitScript(() => {
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
      '../public/models/observatory/surfaces/observatory-surfaces-v1.bin',
      import.meta.url,
    ),
  )
  let lateRouteResult = 'not released'
  await page.route(`**${SCENE_DETAIL_URL}`, async (route) => {
    arrived()
    await waiting
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: bundle,
      })
      lateRouteResult = 'Delayed response delivered after disposal'
    } catch (error) {
      lateRouteResult = `Request aborted before fulfillment: ${String(error)}`
    } finally {
      handled()
    }
  })
  await page.goto(`${base}/observatory`)
  await Promise.race([
    requested,
    delay(60000, undefined, { ref: false }).then(() => {
      throw new Error('Scene detail request did not arrive')
    }),
  ])
  await page.waitForFunction(
    () => {
      const snapshot = window.__observatory?.runtime.snapshot()
      return (
        snapshot?.bookDetail.status === 'ready' &&
        snapshot.sceneDetail.status === 'loading' &&
        snapshot.assets.every((asset) => asset.status === 'ready') &&
        snapshot.frame.submissions > 2
      )
    },
    undefined,
    { timeout: 60000 },
  )
  const probe = () =>
    page!.evaluate(
      () =>
        (
          window as Window & {
            __surfaceTextureProbe?: { created: number; destroyed: number }
          }
        ).__surfaceTextureProbe,
    )
  const beforeDispose = await probe()
  await page.evaluate(() => {
    window.__observatory!.runtime.dispose()
  })
  release()
  await Promise.race([
    fulfilled,
    delay(10000, undefined, { ref: false }).then(() => {
      throw new Error('Delayed scene detail route did not finish')
    }),
  ])
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve()
          }),
        ),
      ),
  )
  const afterDispose = await probe()
  assert.ok(beforeDispose && afterDispose)
  assert.equal(
    afterDispose.created,
    beforeDispose.created,
    'No texture allocation after late response',
  )
  assert.equal(
    afterDispose.created,
    afterDispose.destroyed,
    'All explicitly created GPU textures destroyed',
  )
  const disposed = await state()
  assert.equal(disposed.ready, false)
  assert.equal(disposed.sceneDetail.textureCount, 0)
  assert.equal(disposed.bookDetail.textureCount, 0)
  assert.deepEqual(disposed.errors, [])
  report.lateDispose = {
    beforeDispose,
    afterDispose,
    disposed,
    lateRouteResult,
  }
  await page.close()
}

try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 950 },
  })
  await context.addInitScript(
    ({ key, progress }) => {
      localStorage.setItem(key, JSON.stringify(progress))
    },
    { key: JOURNEY_STORAGE_KEY, progress: store.read().progress },
  )
  if (motionOnly) {
    await verifyMotion(context)
  } else if (recoveryOnly) {
    await verifyRecovery(context)
  } else {
    page = await context.newPage()
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (
        message.type() === 'error' ||
        /computations created outside/.test(message.text())
      )
        errors.push(message.text())
    })
    await page.clock.install({ time: new Date('2026-10-21T12:00:00Z') })
    assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
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
      assert.deepEqual(desktop().special, before.special)
      report.placement = {
        hiddenAgentWorkspace: true,
        foregroundUnchanged:
          desktop().active === before.active &&
          desktop().workspace === before.workspace,
      }
    }
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(() =>
        window.__observatory?.runtime.snapshot(),
      )
      if (snapshot?.error) throw new Error(snapshot.error)
      if (snapshot?.bookDetail.status === 'error')
        throw new Error(snapshot.bookDetail.error)
      if (verifyDetail && snapshot?.sceneDetail.status === 'error')
        throw new Error(snapshot.sceneDetail.error)
      if (
        snapshot?.ready &&
        snapshot.assets.every((asset) => asset.status === 'ready') &&
        snapshot.frame.submissions > 2 &&
        snapshot.bookDetail.status === 'ready' &&
        (!verifyDetail || snapshot.sceneDetail.status === 'ready')
      )
        break
      await delay(100)
    }
    await page.clock.pauseAt(
      new Date((await page.evaluate(() => Date.now())) + 100),
    )
    const initial = await state()
    report.initial = initial
    assert.ok(initial.ready, initial.error)
    assert.ok(!/swiftshader|llvmpipe/i.test(initial.adapter))
    assert.ok(
      initial.assets.every((asset) => asset.status === 'ready'),
      JSON.stringify(initial.assets),
    )
    await page.evaluate(() => {
      window.__observatory!.runtime.setMotion(false)
    })
    await capture('overview-material-1440')
    await page.screenshot({
      path: path.join(out, 'overview-material-close.png'),
      clip: { x: 0, y: 485, width: 1440, height: 230 },
    })
    await capture('overview-clay-1440', 1440, 950, true)
    await capture('overview-material-390', 390, 844)
    await page.setViewportSize({ width: 1440, height: 950 })
    await advance()
    await button('Tideweave').click()
    await button('Play again').click()
    await advance()
    await finishBridge()
    await capture('bridge-material-1440')
    await capture('bridge-clay-1440', 1440, 950, true)
    await capture('bridge-material-390', 390, 844)
    await page.setViewportSize({ width: 1440, height: 950 })
    await page.evaluate(() => {
      window.__observatory!.runtime.setClay(false)
    })
    await advance()
    await button('Return to worlds').click()
    await button('Open temple signal').click()
    await advance()
    await capture('temple-before-reveal-1440')
    await button('Listen together').click()
    const started = Date.now()
    let peak = 0
    while (Date.now() - started < 45000) {
      await advance(32)
      await delay(32)
      const sound = await page.evaluate(() =>
        window.__observatory!.audio.snapshot(),
      )
      peak = Math.max(peak, sound.level)
      if (
        (await page.locator('.temple-ending').getAttribute('data-phase')) ===
        'complete'
      )
        break
    }
    assert.equal(
      await page.locator('.temple-ending').getAttribute('data-phase'),
      'complete',
    )
    assert.ok(peak > 0.001)
    report.templePassage = {
      actualListenButton: true,
      peak,
      elapsedMs: Date.now() - started,
    }
    await advance()
    assert.equal((await state()).visual.temple.revealed, true)
    await capture('temple-material-1440')
    await page.screenshot({
      path: path.join(out, 'temple-material-close.png'),
      clip: { x: 350, y: 125, width: 740, height: 620 },
    })
    await capture('temple-clay-1440', 1440, 950, true)
    await capture('temple-material-390', 390, 844)
    report.final = await state()
    if (verifyDetail) {
      await page.setViewportSize({ width: 1440, height: 950 })
      await page.evaluate(() => {
        window.__observatory!.runtime.setClay(false)
      })
      await advance()
      const study = await state()
      const style = await page.addStyleTag({
        content: '.temple-ending { visibility: hidden !important; }',
      })
      await page.screenshot({
        path: path.join(out, 'temple-material-study-1440.png'),
      })
      await style.evaluate((element) => {
        element.parentNode?.removeChild(element)
      })
      await page.evaluate(() => {
        window.__observatory!.runtime.resetCamera()
      })
      await advance()
      report.templeStudy = {
        note: 'Diagnostic only: ending overlay temporarily hidden to inspect materials at the same fixed temple camera. Main journey shots keep ordinary UI. Temple view intentionally disables camera orbit and zoom.',
        study,
      }
    }
    if (verifyDetail) {
      const detail = (await state()).sceneDetail
      assert.deepEqual(
        detail,
        initial.sceneDetail,
        'Overview and temple share one retained array',
      )
      assert.equal(detail.textureBytes, 4194300)
      assert.equal(detail.textureCount, 1)
      assert.equal(detail.uploads, 1)
      assert.equal(detail.mipCount, 10)
      // Playwright clocks are shared by pages in this context.
      await page.clock.resume()
      await page.close()
      await verifyRecovery(context)
    }
  }
  assert.deepEqual(errors, [])
} catch (error) {
  report.failure = String(error)
  if (page && !page.isClosed()) {
    report.lastState = await state().catch(() => undefined)
    await page
      .screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 })
      .catch(() => undefined)
  }
  throw error
} finally {
  await browser.close()
  await writeFile(
    path.join(out, 'scene-surfaces.json'),
    JSON.stringify(report, null, 2),
  )
}
console.info(`Scene surface proof written to ${out}`)
