// Exercise the Almanac on a real desktop GPU without the repository's software-adapter runner.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import type { MotifAudio } from '../src/almanac/motifAudio'
import type { BenchRuntime } from '../src/bench/runtime'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192/almanac'
const out = path.resolve(process.env.VERIFY_OUT_DIR ?? 'artifacts/almanac')
await mkdir(out, { recursive: true })
const errors: string[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  nativeHeadsetTested: false,
  errors,
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
  const clients = get('clients') as {
    address: string
    class: string
    workspace: { name: string }
  }[]
  return {
    active: active.address,
    workspace: workspace.id,
    special: monitors.map((monitor) => [
      monitor.id,
      monitor.specialWorkspace.name,
    ]),
    clients: clients.map((client) => ({
      address: client.address,
      class: client.class,
      workspace: client.workspace.name,
    })),
  }
}
const desktopBefore = process.env.HYPRLAND_INSTANCE_SIGNATURE
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
    hasTouch: true,
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
  assert.equal(
    (await page.goto(base, { waitUntil: 'networkidle' }))?.status(),
    200,
  )
  if (desktopBefore) {
    const after = desktopState()
    const owned = after.clients.filter(
      (client) =>
        !desktopBefore.clients.some(
          (before) => before.address === client.address,
        ),
    )
    assert.ok(owned.length > 0)
    assert.ok(
      owned.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace === 'special:agents',
      ),
    )
    assert.equal(after.active, desktopBefore.active)
    assert.equal(after.workspace, desktopBefore.workspace)
    assert.deepEqual(after.special, desktopBefore.special)
    report.browserPlacement = {
      hiddenAgentWorkspace: true,
      foregroundUnchanged: true,
    }
  }
  await page.waitForFunction(
    () =>
      window.__almanac?.runtime.snapshot().ready ||
      window.__almanac?.runtime.snapshot().error,
    undefined,
    { timeout: 60000 },
  )
  const gpu = (): Promise<ReturnType<BenchRuntime['snapshot']>> =>
    page.evaluate(() => window.__almanac!.runtime.snapshot())
  const audio = (): Promise<ReturnType<MotifAudio['snapshot']>> =>
    page.evaluate(() => window.__almanac!.audio.snapshot())
  const frames = async (count = 2) => {
    const before = (await gpu()).submissions ?? 0
    await page.waitForFunction(
      (target) =>
        (window.__almanac?.runtime.snapshot().submissions ?? 0) >= target,
      before + count,
      { timeout: 60000 },
    )
  }
  assert.equal((await gpu()).ready, true, (await gpu()).error)
  assert.ok(!/swiftshader|llvmpipe/i.test((await gpu()).adapter))
  await frames()
  report.adapter = (await gpu()).adapter
  assert.equal(
    await page.evaluate(() => window.__almanac!.selectedId),
    'glasswake',
  )
  assert.equal((await gpu()).settings.recipe, 0)
  assert.equal((await audio()).playing, false)
  const canvas = page.locator('canvas')
  const originalCanvas = await canvas.elementHandle()
  assert.ok(originalCanvas)
  await canvas.focus()
  await canvas.press('ArrowRight')
  const savedYaw = (await gpu()).settings.yaw
  const generation = (await gpu()).generation
  await page.getByRole('button', { name: /Inspect orb/ }).click()
  await page.waitForFunction(() => window.__almanac!.inspecting)
  await frames()
  assert.equal(
    await page.evaluate(
      (element) => element === document.querySelector('canvas'),
      originalCanvas,
    ),
    true,
  )
  assert.equal((await gpu()).generation, generation)
  assert.equal((await gpu()).settings.yaw, savedYaw)
  await page.screenshot({
    path: path.join(out, 'desktop-inspect.png'),
    fullPage: true,
  })
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => window.__almanac!.inspecting), false)
  assert.equal(
    await page
      .getByRole('button', { name: /Inspect orb/ })
      .evaluate((button) => document.activeElement === button),
    true,
  )

  await page.getByRole('button', { name: /Play motif/ }).click()
  await page.waitForFunction(() => window.__almanac!.audio.snapshot().playing)
  await page.waitForFunction(
    () => window.__almanac!.audio.snapshot().level > 0.001,
    undefined,
    { polling: 50, timeout: 15000 },
  )
  report.glasswakeAudio = await audio()
  assert.equal((await audio()).motifId, 'glasswake-first-light')
  await page.getByRole('button', { name: /^Tideweave/ }).click()
  assert.equal((await audio()).playing, false)
  await frames()
  assert.equal((await gpu()).settings.recipe, 1)
  assert.equal(
    (await gpu()).settings.yaw,
    0,
    'Each world starts with its own view',
  )
  await canvas.focus()
  await canvas.press('ArrowLeft')
  const tideweaveYaw = (await gpu()).settings.yaw
  await page.getByRole('button', { name: /Play motif/ }).click()
  await page.waitForFunction(
    () =>
      window.__almanac!.audio.snapshot().playing &&
      window.__almanac!.audio.snapshot().level > 0.001,
    undefined,
    { polling: 50, timeout: 15000 },
  )
  report.tideweaveAudio = await audio()
  assert.equal((await audio()).motifId, 'tideweave-rising-sixth')
  await page.getByRole('button', { name: /Stop motif/ }).click()
  assert.equal((await audio()).playing, false)
  await page.getByRole('button', { name: /^Glasswake/ }).click()
  await frames()
  assert.equal((await gpu()).settings.yaw, savedYaw)
  assert.equal((await gpu()).settings.recipe, 0)
  await page.getByRole('button', { name: /^Tideweave/ }).click()
  assert.equal((await gpu()).settings.yaw, tideweaveYaw)
  await page.getByRole('button', { name: /^Glasswake/ }).click()
  await page.getByRole('button', { name: /^Ember Relay/ }).click()
  assert.equal((await gpu()).active, false)
  assert.equal((await audio()).playing, false)
  const previewSubmissions = (await gpu()).submissions
  await page.waitForTimeout(1200)
  assert.equal(
    (await gpu()).submissions,
    previewSubmissions,
    'Preview-only entry must not keep rendering a hidden flame',
  )
  assert.equal(await canvas.isVisible(), false)
  await page.screenshot({
    path: path.join(out, 'desktop-preview.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: /^Glasswake/ }).click()
  await frames()
  const layouts = []
  for (const viewport of [
    { width: 1440, height: 950 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await frames()
    const bounds = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!.getBoundingClientRect()
      return {
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      }
    })
    assert.ok(
      bounds.width <= viewport.width + 1,
      `Overflow at ${viewport.width}px`,
    )
    assert.ok(bounds.canvasWidth > 120 && bounds.canvasHeight > 200)
    layouts.push(bounds)
    await page.screenshot({
      path: path.join(out, `spread-${viewport.width}.png`),
      fullPage: true,
    })
  }
  report.layouts = layouts
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  assert.ok(bounds)
  const x = bounds.x + bounds.width * 0.5
  const y = bounds.y + bounds.height * 0.5
  const beforeTouch = (await gpu()).settings.yaw
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 55, y: y + 12, id: 1 }],
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  assert.ok(Math.abs((await gpu()).settings.yaw - beforeTouch) > 10)
  await cdp.detach()
  await page.getByRole('button', { name: /Inspect orb/ }).tap()
  await frames()
  assert.equal(await page.evaluate(() => window.__almanac!.inspecting), true)
  await page.screenshot({
    path: path.join(out, 'phone-inspect.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: /Return to Almanac/ }).tap()
  assert.equal(await page.evaluate(() => window.__almanac!.inspecting), false)
  report.input = {
    keyboardOrbit: true,
    escapeAndFocusRestore: true,
    cdpTouchDrag: true,
    phoneInspectReturn: true,
  }
  assert.deepEqual((await gpu()).errors, [])
  assert.deepEqual(errors, [])

  await page.evaluate(() => {
    window.__almanac!.runtime.loseDeviceForTest()
  })
  await page.waitForFunction(() =>
    /GPU device lost/.test(window.__almanac?.runtime.snapshot().error ?? ''),
  )
  await page.getByText(/GPU device lost/).waitFor()
  assert.equal((await gpu()).ready, false)
  report.deviceLoss = { surfaced: true, ready: false }

  const unsupported = await context.newPage()
  await unsupported.addInitScript(() => {
    Object.defineProperty(window.navigator, 'gpu', { value: undefined })
  })
  await unsupported.goto(base)
  await unsupported
    .getByText(/Open this bench in a WebGPU-enabled browser/)
    .waitFor()
  await unsupported.getByRole('button', { name: /^Tideweave/ }).click()
  assert.equal(
    await unsupported.evaluate(() => window.__almanac!.selectedId),
    'tideweave',
  )
  report.unsupportedGpu = { errorVisible: true, catalogStillUsable: true }
  await unsupported.close()

  const pending = await context.newPage()
  await pending.addInitScript(() => {
    const resume = Object.getOwnPropertyDescriptor(
      AudioContext.prototype,
      'resume',
    )!.value as (this: AudioContext) => Promise<void>
    AudioContext.prototype.resume = async function (this: AudioContext) {
      await resume.call(this)
      await new Promise<void>((resolve) => {
        ;(
          window as Window & { releaseAlmanacAudio?: () => void }
        ).releaseAlmanacAudio = resolve
      })
    }
  })
  await pending.goto(base)
  await pending.getByRole('button', { name: 'Play motif', exact: true }).click()
  await pending.waitForFunction(() =>
    Boolean(
      (window as Window & { releaseAlmanacAudio?: () => void })
        .releaseAlmanacAudio,
    ),
  )
  await pending
    .getByRole('button', { name: 'Cancel motif', exact: true })
    .click()
  await pending.evaluate(() => {
    ;(
      window as Window & { releaseAlmanacAudio?: () => void }
    ).releaseAlmanacAudio?.()
  })
  assert.equal(
    await pending.evaluate(() => window.__almanac!.audio.snapshot().playing),
    false,
  )
  assert.equal(
    await pending
      .getByRole('button', { name: 'Play motif', exact: true })
      .isVisible(),
    true,
  )
  report.pendingAudio = { cancelButtonWorks: true, lateStartPrevented: true }
  await pending.close()

  await page.goto(new URL('/bench', base).href)
  await page.waitForFunction(
    () => window.__orbBench?.snapshot().ready,
    undefined,
    { timeout: 60000 },
  )
  assert.deepEqual(
    await page.evaluate(() => window.__orbBench!.snapshot().errors),
    [],
  )
  await page.getByRole('link', { name: 'Open Almanac' }).waitFor()
  await page.goto(new URL('/', base).href)
  await page.waitForFunction(
    () => window.__lumenGpuXr?.snapshot().ready,
    undefined,
    { timeout: 60000 },
  )
  report.existingRoutes = { benchReady: true, originalLabReady: true }
  assert.deepEqual(errors, [])
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = error instanceof Error ? error.stack : String(error)
  throw error
} finally {
  try {
    await writeFile(
      path.join(out, 'verification.json'),
      JSON.stringify(report, null, 2),
    )
  } finally {
    await browser.close()
  }
}
console.info(JSON.stringify(report, null, 2))
