// Standalone real-GPU bench verification, including CPU parity, input and framebuffer depth.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import type { BenchSettings } from '../src/bench/settings'
import type * as BenchGpuHarness from '../tests/benchGpuHarness'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192/bench'
const out = path.resolve(process.env.VERIFY_OUT_DIR ?? 'artifacts/bench')
await mkdir(out, { recursive: true })
const errors: string[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  nativeHeadsetTested: false,
  errors,
}
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
    acceptDownloads: true,
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
  const snapshot = () => page.evaluate(() => window.__orbBench!.snapshot())
  const set = (patch: Partial<BenchSettings>) =>
    page.evaluate((patch) => {
      window.__orbBench!.setSettings(patch)
    }, patch)
  const frames = async (count = 3) => {
    const before = (await snapshot()).submissions ?? 0
    await page.waitForFunction(
      (target) => (window.__orbBench?.snapshot().submissions ?? 0) >= target,
      before + count,
      { timeout: 60000 },
    )
  }
  const read = (source: 'compute' | 'cached' = 'compute') =>
    page.evaluate(
      (source) => window.__orbBench!.readPoints(32768, source),
      source,
    )
  assert.equal(
    (await page.goto(base, { waitUntil: 'networkidle' }))?.status(),
    200,
  )
  await page.waitForFunction(
    () =>
      window.__orbBench?.snapshot().ready ||
      window.__orbBench?.snapshot().error,
    undefined,
    { timeout: 60000 },
  )
  const initial = await snapshot()
  assert.equal(initial.ready, true, initial.error)
  assert.ok(
    initial.adapter && !/swiftshader|llvmpipe/i.test(initial.adapter),
    `Hardware adapter required: ${initial.adapter}`,
  )
  report.adapter = initial.adapter
  report.initial = initial
  const parity: Record<string, unknown>[] = []
  await page
    .getByRole('combobox', { name: /Point count/ })
    .selectOption('32768')
  for (const [recipe, name] of ['Aureole', 'Thicket', 'Vesper'].entries()) {
    await page
      .getByRole('combobox', { name: /Point source/ })
      .selectOption('compute')
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
    await frames()
    assert.equal((await snapshot()).settings.recipe, recipe)
    const generation = (await snapshot()).generation
    await page.evaluate(() => {
      window.__orbBench!.rebuild()
    })
    await page.waitForFunction(
      (before) => (window.__orbBench?.snapshot().generation ?? 0) > before,
      generation,
    )
    const gpu = await read()
    assert.equal(gpu?.length, 32768)
    assert.ok(gpu.flat().every(Number.isFinite))
    assert.ok(gpu.some((point) => Math.hypot(...point.slice(0, 3)) > 0.1))
    const rebuiltGeneration = (await snapshot()).generation
    await page.evaluate(() => {
      window.__orbBench!.rebuild()
    })
    await page.waitForFunction(
      (before) => (window.__orbBench?.snapshot().generation ?? 0) > before,
      rebuiltGeneration,
    )
    assert.deepEqual(
      await read(),
      gpu,
      `${name} same-seed GPU rebuild must be exact`,
    )
    await page
      .getByRole('combobox', { name: /Point source/ })
      .selectOption('cached')
    await page.waitForFunction(
      () => {
        const state = window.__orbBench?.snapshot()
        return state && !state.sampling && state.activeSource === 'cached'
      },
      undefined,
      { timeout: 60000 },
    )
    const cached = await read('cached')
    assert.equal(cached?.length, gpu.length)
    let maximumError = 0
    for (let point = 0; point < gpu.length; point++) {
      for (let axis = 0; axis < 4; axis++) {
        assert.ok(Number.isFinite(cached[point][axis]))
        maximumError = Math.max(
          maximumError,
          Math.abs(cached[point][axis] - gpu[point][axis]),
        )
      }
    }
    assert.ok(
      maximumError < 0.00015,
      `${name} CPU/GPU parity error ${maximumError}`,
    )
    parity.push({
      recipe,
      name,
      comparedPoints: gpu.length,
      maximumError,
      repeatedGpuBuildExact: true,
    })
    const stableGeneration = (await snapshot()).generation
    for (const [angle, yaw, pitch] of [
      ['Side', 90, 0],
      ['Above', 0, 70],
      ['Front', 0, 0],
    ] as const) {
      await page.getByRole('button', { name: angle, exact: true }).click()
      await frames()
      const state = await snapshot()
      assert.equal(state.settings.yaw, yaw)
      assert.equal(state.settings.pitch, pitch)
      assert.equal(state.generation, stableGeneration)
    }
    await page.getByRole('button', { name: 'Ember', exact: true }).click()
    await page.getByLabel('Orbital rings', { exact: true }).uncheck()
    await frames()
    assert.equal((await snapshot()).generation, stableGeneration)
    assert.deepEqual(
      await read(),
      gpu,
      'Presentation controls must preserve GPU points',
    )
    await page.getByRole('button', { name: 'Lagoon', exact: true }).click()
    await page.getByLabel('Orbital rings', { exact: true }).check()
    await page
      .getByRole('combobox', { name: /Point source/ })
      .selectOption('compute')
    await frames()
    await page.screenshot({
      path: path.join(out, `desktop-${name.toLowerCase()}.png`),
      fullPage: true,
    })
  }
  report.parity = parity
  report.depth = await page.evaluate(async () => {
    const modulePath = '/tests/benchGpuHarness.ts'
    const module = (await import(modulePath)) as typeof BenchGpuHarness
    return module.verifyBenchGpuContracts()
  })

  const downloadPromise = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Save study settings', exact: true })
    .click()
  const download = await downloadPromise
  const savedPath = path.join(out, download.suggestedFilename())
  await download.saveAs(savedPath)
  const saved = JSON.parse(await readFile(savedPath, 'utf8')) as {
    schema: string
    version: number
    settings: BenchSettings
  }
  assert.equal(saved.schema, 'lumen-orb-study')
  assert.equal(saved.version, 1)
  assert.deepEqual(saved.settings, (await snapshot()).settings)
  report.savedStudy = download.suggestedFilename()

  const layouts: Record<string, unknown>[] = []
  for (const viewport of [
    { width: 1440, height: 950 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await frames()
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!.getBoundingClientRect()
      const controls = [
        ...document.querySelectorAll<HTMLElement>('button,input,select'),
      ].filter((element) => element.getClientRects().length)
      return {
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        overflowingControls: controls
          .filter((element) => {
            const bounds = element.getBoundingClientRect()
            return bounds.left < -1 || bounds.right > window.innerWidth + 1
          })
          .map(
            (element) =>
              element.getAttribute('aria-label') ?? element.textContent?.trim(),
          ),
      }
    })
    assert.ok(
      layout.scrollWidth <= viewport.width + 1,
      `Horizontal overflow at ${viewport.width}px`,
    )
    assert.ok(layout.canvasWidth > 120 && layout.canvasHeight > 200)
    assert.deepEqual(layout.overflowingControls, [])
    layouts.push({ viewport, ...layout })
  }
  report.layouts = layouts
  await page.screenshot({
    path: path.join(out, 'phone-vesper.png'),
    fullPage: true,
  })
  const canvas = page.getByLabel(
    'Interactive three-dimensional fractal specimen',
    { exact: true },
  )
  await canvas.scrollIntoViewIfNeeded()
  await canvas.focus()
  const beforeKey = (await snapshot()).settings.yaw
  await canvas.press('ArrowRight')
  assert.equal((await snapshot()).settings.yaw, beforeKey + 5)
  const bounds = await canvas.boundingBox()
  assert.ok(bounds)
  const x = bounds.x + bounds.width * 0.5
  const y = bounds.y + bounds.height * 0.45
  const beforeTouch = (await snapshot()).settings.yaw
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
    touchPoints: [{ x: x + 60, y: y + 20, id: 1 }],
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await frames()
  assert.ok(
    Math.abs((await snapshot()).settings.yaw - beforeTouch) > 10,
    'Real touch drag must change orbit',
  )
  report.input = { keyboardOrbit: true, cdpTouchDrag: true }
  await cdp.detach()

  await set({ source: 'compute', pointCount: 524288 })
  await frames()
  assert.equal((await snapshot()).pointCount, 524288)
  report.highQuality = await snapshot()
  assert.deepEqual((await snapshot()).errors, [])
  assert.deepEqual(errors, [])
  await page.evaluate(() => {
    window.__orbBench!.loseDeviceForTest()
  })
  await page.waitForFunction(
    () => /GPU device lost/.test(window.__orbBench?.snapshot().error ?? ''),
    undefined,
    { timeout: 10000 },
  )
  assert.equal((await snapshot()).ready, false)
  assert.equal(
    await page
      .getByRole('button', { name: 'Save study settings', exact: true })
      .isDisabled(),
    true,
  )
  await page
    .getByRole('button', { name: 'Reload bench', exact: true })
    .waitFor()
  report.deviceLoss = {
    surfaced: true,
    controlsDisabled: true,
    message: (await snapshot()).error,
  }
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
