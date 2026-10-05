/** Hardware-Chrome proof of recorded GPU pointer pixels and live gummy controls. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { gummyArmPoint, waitForGummyControlsLayout, } from './gummy-study-input-checks.mjs'

const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const output = resolve(
  process.env.GUMMY_POINTER_OUTPUT ?? '/tmp/gummy-pointer-tuning',
)
const hypr = (command) =>
  JSON.parse(execFileSync('hyprctl', ['-j', command], { encoding: 'utf8' }))
const desktop = () => ({
  window: hypr('activewindow').address,
  workspace: hypr('activeworkspace').id,
  monitors: hypr('monitors').map((monitor) => ({
    id: monitor.id,
    special: monitor.specialWorkspace.name,
  })),
})
const before = desktop()
const clientsBefore = new Set(hypr('clients').map((client) => client.address))
const report = {
  startedAt: new Date().toISOString(),
  base,
  errors: [],
  warnings: [],
  failures: [],
}
mkdirSync(output, { recursive: true })
const save = () => {
  writeFileSync(
    resolve(output, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
}
const rawPixels = (input) =>
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      'pipe:0',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { input, timeout: 10000, maxBuffer: 20 * 1024 * 1024 },
  )

function cyanCount(pixels, width, point, frameOffset = 0) {
  let count = 0
  for (let y = Math.round(point.y) - 17; y <= Math.round(point.y) + 17; y++)
    for (let x = Math.round(point.x) - 17; x <= Math.round(point.x) + 17; x++) {
      const offset = frameOffset + (y * width + x) * 3
      if (
        pixels[offset + 1] - pixels[offset] > 28 &&
        pixels[offset + 2] - pixels[offset] > 35
      )
        count++
    }
  return count
}

let browser, timer
try {
  const { chromium } = createRequire(import.meta.url)('playwright')
  browser = await chromium.launch({
    headless: false,
    env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
    args: [
      '--class=agent-browser',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--ignore-gpu-blocklist',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  })
  timer = setTimeout(() => {
    report.failures.push('Pointer verification exceeded 120 seconds')
    save()
    void browser.close()
  }, 120000)
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
    if (message.type() === 'warning') report.warnings.push(message.text())
  })
  await page.goto(`${base}/gummy?experiment=mpm`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForFunction(
    () =>
      window.__gummyParticleStudy &&
      document.querySelector('[data-ready="true"]'),
    undefined,
    { timeout: 30000 },
  )
  await waitForGummyControlsLayout(page)
  const canvas = page.getByTestId('gummy-bear-canvas')
  const button = (name) => page.getByRole('button', { name, exact: true })
  const guide = page.getByRole('checkbox', {
    name: 'Pointer guide',
    exact: true,
  })
  assert.deepEqual(desktop(), before)
  const clients = hypr('clients').filter(
    (client) => !clientsBefore.has(client.address),
  )
  assert.ok(
    clients.length &&
      clients.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace.name === 'special:agents',
      ),
  )
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter()
    return {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      fallback:
        adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
    }
  })
  assert.equal(report.adapter.fallback, false)
  await page.evaluate(() => {
    window.__gummyParticleStudy.resetPaused()
    window.__pointerTuningOriginalScene = window.__gummyParticleStudy
  })
  await page.getByText('Fine tuning', { exact: true }).click()
  for (const name of [
    'Grab radius',
    'Grab strength',
    'Maximum pull',
    'Flow',
    'Viscosity',
    'Gravity',
    'Floor drag',
  ]) {
    const range = page.getByRole('slider', { name, exact: true })
    await range.focus()
    await range.press('Home')
  }
  report.liveTuning = await page.evaluate(() => {
    window.__gummyParticleStudy.advanceFrames(1)
    return {
      unchangedScene:
        window.__pointerTuningOriginalScene === window.__gummyParticleStudy,
      ...window.__gummyParticleStudy.info(),
    }
  })
  assert.equal(report.liveTuning.unchangedScene, true)
  assert.deepEqual(report.liveTuning.settings.tuning, {
    grabStrength: 0.1,
    flow: 0,
    gravity: 0,
    floorDrag: 0,
    viscosity: 0,
  })
  assert.equal(report.liveTuning.settings.grabRadius, 0.08)
  assert.equal(report.liveTuning.settings.maxPull, 0.2)
  await button('Short pull preset').click()
  const preset = await page.evaluate(
    () => window.__gummyParticleStudy.info().settings,
  )
  assert.deepEqual(preset.tuning, {
    grabStrength: 0.45,
    flow: 0.3,
    gravity: 0,
    floorDrag: 8,
    viscosity: 0,
  })
  assert.equal(preset.grabRadius, 0.14)
  assert.equal(preset.maxPull, 0.65)
  await button('Restore tuning').click()
  report.restored = await page.evaluate(() => ({
    unchangedScene:
      window.__pointerTuningOriginalScene === window.__gummyParticleStudy,
    settings: window.__gummyParticleStudy.info().settings,
  }))
  assert.equal(report.restored.unchangedScene, true)
  assert.deepEqual(report.restored.settings.tuning, {
    grabStrength: 1,
    flow: 1,
    gravity: 1,
    floorDrag: 5,
    viscosity: 1,
  })
  await page.screenshot({ path: resolve(output, 'desktop-tuning.png') })
  save()

  await guide.check()
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  const size = await canvas.evaluate((element) => ({
    width: element.width,
    height: element.height,
  }))
  const points = [
    { x: Math.round(size.width * 0.14), y: Math.round(size.height * 0.15) },
    { x: Math.round(size.width * 0.28), y: Math.round(size.height * 0.15) },
  ]
  const aim = async (point) => {
    await page.mouse.move(
      bounds.x + (point.x * bounds.width) / size.width,
      bounds.y + (point.y * bounds.height) / size.height,
    )
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
          .pointerGuide === 'hover',
    )
  }
  await aim(points[0])
  const visible = rawPixels(
    await canvas.screenshot({ path: resolve(output, 'pointer-visible.png') }),
  )
  await guide.uncheck()
  await canvas.scrollIntoViewIfNeeded()
  await page.mouse.move(bounds.x + points[0].x, bounds.y + points[0].y)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
        .pointerGuide === 'off',
  )
  const hidden = rawPixels(
    await canvas.screenshot({ path: resolve(output, 'pointer-hidden.png') }),
  )
  report.pixels = {
    visibleCyan: cyanCount(visible, size.width, points[0]),
    hiddenCyan: cyanCount(hidden, size.width, points[0]),
  }
  assert.ok(
    report.pixels.visibleCyan > report.pixels.hiddenCyan + 30,
    'The marker must alter actual canvas pixels',
  )
  save()

  await guide.check()
  await button('Record').click()
  await canvas.scrollIntoViewIfNeeded()
  await aim(points[0])
  await page.waitForTimeout(800)
  await aim(points[1])
  await page.waitForTimeout(800)
  await page.mouse.move(bounds.x + bounds.width + 15, bounds.y + 30)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
        .pointerGuide === 'off',
  )
  await page.waitForTimeout(800)
  await button('Stop recording').click()
  await page
    .getByTestId('gummy-recording-status')
    .filter({ hasText: 'ready' })
    .waitFor()
  const downloadPromise = page.waitForEvent('download')
  await button('Download video').click()
  const download = await downloadPromise
  const videoPath = resolve(output, download.suggestedFilename())
  await download.saveAs(videoPath)
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-count_frames',
        '-show_entries',
        'stream=codec_name,width,height,nb_read_frames:format=duration',
        '-of',
        'json',
        videoPath,
      ],
      { encoding: 'utf8', timeout: 10000 },
    ),
  )
  const stream = probe.streams[0],
    stride = stream.width * stream.height * 3
  // AVC encoders may round odd canvas dimensions down to their even pixel grid.
  assert.ok(Math.abs(stream.width - size.width) <= 1)
  assert.ok(Math.abs(stream.height - size.height) <= 1)
  const encodedPoints = points.map((point) => ({
    x: (point.x * stream.width) / size.width,
    y: (point.y * stream.height) / size.height,
  }))
  const frames = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      videoPath,
      '-vf',
      'fps=8',
      '-frames:v',
      '40',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { timeout: 15000, maxBuffer: stride * 41 },
  )
  const samples = Array.from(
    { length: Math.floor(frames.length / stride) },
    (_, index) =>
      encodedPoints.map((point) =>
        cyanCount(frames, stream.width, point, index * stride),
      ),
  )
  report.video = {
    path: videoPath,
    bytes: statSync(videoPath).size,
    probe,
    samples,
  }
  assert.ok(
    samples.some(([a, b]) => a > 25 && b < 10),
    'Decoded video must contain the first marker position',
  )
  assert.ok(
    samples.some(([a, b]) => a < 10 && b > 25),
    'Decoded video must contain the second marker position',
  )
  assert.ok(
    samples.slice(-3).some(([a, b]) => a < 10 && b < 10),
    'Leaving the canvas must remove recorded marker pixels',
  )
  save()

  await page.setViewportSize({ width: 390, height: 844 })
  await waitForGummyControlsLayout(page)
  await canvas.scrollIntoViewIfNeeded()
  await canvas.press('Home')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  })
  const point = await gummyArmPoint(page)
  const liveStart = await page.evaluate(
    () => window.__gummyParticleStudy.info().time,
  )
  await canvas.press('Space')
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...point, id: 1 }],
  })
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
        .pointerGuide === 'grab',
  )
  for (let step = 1; step <= 5; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x + step * 6, y: point.y - step * 2, id: 1 }],
    })
    await page.waitForTimeout(80)
  }
  report.touch = {
    active: await canvas.getAttribute('data-pointer-guide'),
    grip: await page.evaluate(() => window.__gummyParticleStudy.info().grip),
    liveStart,
    liveEnd: await page.evaluate(() => window.__gummyParticleStudy.info().time),
  }
  assert.ok(
    report.touch.liveEnd > liveStart + 0.04,
    'Live simulation must advance during the native touch drag',
  )
  await page.screenshot({ path: resolve(output, 'phone-grab.png') })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
        .pointerGuide === 'off',
  )
  report.touch.released = true
  await canvas.press('Space')
  await page
    .getByRole('slider', { name: 'Gravity', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'phone-tuning.png') })
  report.mobileControls = await page
    .getByTestId('gummy-tuning-controls')
    .evaluate((element) => {
      const button = element.querySelector('button'),
        style = window.getComputedStyle(button),
        rect = button.getBoundingClientRect()
      return {
        width: element.getBoundingClientRect().width,
        scrollWidth: document.querySelector('main').scrollWidth,
        viewport: window.innerWidth,
        buttonHeight: rect.height,
        background: style.backgroundColor,
        border: style.borderTopStyle,
      }
    })
  assert.ok(
    report.mobileControls.width <= 390 &&
      report.mobileControls.buttonHeight >= 44,
  )
  assert.ok(report.mobileControls.scrollWidth <= 390)
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.warnings, [])
  report.passed = true
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  clearTimeout(timer)
  await browser?.close()
  report.finalDesktop = desktop()
  save()
  console.info(`Pointer and tuning report: ${resolve(output, 'report.json')}`)
}
