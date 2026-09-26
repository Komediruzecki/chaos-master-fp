// Standalone headed hardware verification; no SwiftShader or WebXR emulator.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { verifyMusic } from './verifyMusic'
import type * as GpuHarness from '../tests/gpuHarness'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5190/'
const out = path.resolve(process.env.VERIFY_OUT_DIR ?? 'artifacts')
const production = process.env.VERIFY_PRODUCTION === '1'
await mkdir(out, { recursive: true })
const args = [
  '--class=agent-browser',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const browser = await chromium.launch({ headless: false, args })
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 950 },
})
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (
    message.type() === 'error' ||
    /computations created outside/.test(message.text())
  )
    errors.push(message.text())
})
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  production,
  args,
  nativeHeadsetTested: false,
  errors,
}
const read = () => page.evaluate(() => window.__lumenGpuXr!.snapshot())
// Let control changes and GPU draws reach presentation frames before capture.
// Use frame callbacks rather than an arbitrary wall-clock sleep.
const present = (target = page) =>
  target.evaluate(async () => {
    for (let i = 0; i < 5; i++)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve()
        }),
      )
  })
const frames = async (count = 4) => {
  const start = (await read()).submissions ?? 0
  await page.waitForFunction(
    (start) => (window.__lumenGpuXr?.snapshot().submissions ?? 0) >= start,
    start + count,
    // Hidden Hyprland workspaces can throttle rAF; this is not a benchmark.
    { timeout: 60000 },
  )
}
try {
  assert.equal(
    (await page.goto(base, { waitUntil: 'networkidle' }))?.status(),
    200,
  )
  await page.getByRole('button', { name: 'Start rotation' }).waitFor()
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>('.button-row button')
        ?.disabled,
  )
  if (!production) {
    await page.waitForFunction(
      () => window.__lumenGpuXr?.snapshot().eyes.length === 1,
    )
    const initial = await read()
    report.initial = initial
    assert.equal(initial.ready, true, initial.error)
    assert.ok(
      initial.caps?.adapter &&
        !/swiftshader|llvmpipe/i.test(initial.caps.adapter),
      'Real GPU required',
    )
    assert.equal(initial.nativeFrames, 0)
    assert.equal(
      initial.caps.xrCandidate,
      false,
      'Desktop verification must not claim a headset',
    )
    assert.equal(
      await page.getByRole('button', { name: 'Enter WebGPU VR' }).isDisabled(),
      true,
    )
    assert.equal(await page.evaluate(() => 'IWER_DEVICE' in window), false)
    await frames()
    const before = await page.evaluate(() =>
      window.__lumenGpuXr!.readPoints('cached'),
    )
    const stopped = (await read()).elapsed
    await frames(10)
    assert.equal((await read()).elapsed, stopped)
    await page.screenshot({ path: path.join(out, 'desktop-cached.png') })
    await page.getByRole('slider', { name: 'Distance' }).fill('1.8')
    await page.getByRole('slider', { name: 'Orbit' }).fill('35')
    await frames(10)
    const moved = await read()
    report.moved = moved
    assert.equal(moved.bufferId, initial.bufferId)
    assert.equal(moved.generation, initial.generation)
    assert.notDeepEqual(moved.eyes[0].view, initial.eyes[0].view)
    assert.deepEqual(
      await page.evaluate(() => window.__lumenGpuXr!.readPoints('cached')),
      before,
      'Camera movement must not mutate the flame',
    )
    await page.screenshot({ path: path.join(out, 'desktop-close.png') })
    await page.getByRole('slider', { name: 'Distance' }).fill('2.9')
    await page.getByRole('slider', { name: 'Orbit' }).fill('0')
    await page.getByRole('button', { name: 'Two-eye preview' }).click()
    await page.waitForFunction(
      () => window.__lumenGpuXr?.snapshot().eyes.length === 2,
    )
    const stereo = await read()
    report.stereo = stereo
    assert.equal(stereo.immersive, false)
    assert.ok(
      Math.abs(
        stereo.eyes[1].position[0] - stereo.eyes[0].position[0] - 0.063,
      ) < 0.00001,
    )
    assert.notDeepEqual(stereo.eyes[0].view, stereo.eyes[1].view)
    await page.screenshot({ path: path.join(out, 'desktop-two-eyes.png') })
    await page.getByLabel('Scene', { exact: true }).selectOption('compute')
    await frames()
    const stablePoints = await page.evaluate(() =>
      window.__lumenGpuXr!.readPoints(),
    )
    assert.ok(
      stablePoints?.some((point) => Math.hypot(...point.slice(0, 3)) > 0.1),
    )
    const stableState = await read()
    assert.equal(stableState.generation, 1)
    await page.getByRole('button', { name: 'Rebuild same GPU flame' }).click()
    await frames()
    assert.equal((await read()).generation, stableState.generation + 1)
    assert.deepEqual(
      await page.evaluate(() => window.__lumenGpuXr!.readPoints()),
      stablePoints,
    )
    const generation = (await read()).generation!
    await page.getByRole('button', { name: 'Start rotation' }).click()
    await frames(30)
    await page.getByRole('button', { name: 'Stop rotation' }).click()
    assert.ok((await read()).elapsed > stableState.elapsed)
    assert.equal((await read()).generation, generation)
    assert.deepEqual(
      await page.evaluate(() => window.__lumenGpuXr!.readPoints()),
      stablePoints,
    )
    report.live = await read()
    assert.equal((await read()).bufferId, initial.bufferId)
    const stoppedGeneration = (await read()).generation
    await frames(10)
    assert.equal((await read()).generation, stoppedGeneration)
    await page.getByRole('button', { name: 'Two-eye preview' }).click()
    await frames()
    await page.screenshot({ path: path.join(out, 'desktop-compute.png') })
    const shader = await page.evaluate(() => window.__lumenGpuXr!.shader())
    assert.match(shader ?? '', /@compute/)
    assert.match(shader ?? '', /read_write/)
    await writeFile(path.join(out, 'compute.wgsl'), shader ?? '')
    report.gpuContracts = await page.evaluate(async () => {
      const modulePath = '/tests/gpuHarness.ts'
      const harness = (await import(modulePath)) as typeof GpuHarness
      return harness.verifyGpuContracts()
    })
    console.info(
      'PASS: actual GPU compute, CPU parity, two real texture-array slices and distinct eye uniforms',
    )
  } else {
    assert.equal(
      await page.evaluate(() => '__lumenGpuXr' in window),
      false,
      'Production must not expose debug hooks',
    )
    await page.getByLabel('Scene', { exact: true }).selectOption('compute')
    const waitForBuild = (count: number) =>
      page.waitForFunction(
        (expected) =>
          Array.from(document.querySelectorAll('dt')).find(
            (label) => label.textContent === 'GPU cloud builds',
          )?.nextElementSibling?.textContent === String(expected),
        count,
      )
    await waitForBuild(1)
    await page.getByRole('button', { name: 'Rebuild same GPU flame' }).click()
    await waitForBuild(2)
    await page.getByRole('button', { name: 'Start rotation' }).click()
    await page.getByRole('button', { name: 'Stop rotation' }).click()
    await present()
    await page.screenshot({ path: path.join(out, 'desktop-compute.png') })
  }
  report.music = await verifyMusic(page, production, out)
  await page.getByLabel('Scene', { exact: true }).selectOption('probe')
  if (!production) await frames()
  else await present()
  await page.screenshot({ path: path.join(out, 'geometry-probe.png') })
  const downloadWait = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save diagnostic report' }).click()
  const download = await downloadWait
  await download.saveAs(path.join(out, 'downloaded-report.json'))
  const downloaded = JSON.parse(
    await readFile(path.join(out, 'downloaded-report.json'), 'utf8'),
  ) as { ready: boolean; nativeFrames: number }
  assert.equal(downloaded.ready, true)
  assert.equal(downloaded.nativeFrames, 0)
  const mobile = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  })
  mobile.on('pageerror', (error) => errors.push(String(error)))
  await mobile.goto(base, { waitUntil: 'networkidle' })
  await mobile.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>('.button-row button')
        ?.disabled,
  )
  const geometry = await mobile.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
      text: button.textContent,
      height: button.getBoundingClientRect().height,
    })),
  }))
  assert.ok(geometry.scroll <= geometry.width, 'No horizontal mobile overflow')
  assert.ok(
    geometry.buttons.every((button) => button.height >= 44),
    'Touch targets must be at least 44px',
  )
  assert.equal(
    await mobile
      .getByRole('slider', { name: 'Music motion', exact: true })
      .inputValue(),
    '0',
    'Reduced motion starts stationary',
  )
  await mobile.getByRole('button', { name: 'Play music', exact: true }).tap()
  await mobile.getByRole('button', { name: 'Pause music', exact: true }).tap()
  await mobile
    .getByRole('button', { name: 'Stationary view', exact: true })
    .tap()
  await mobile.getByRole('button', { name: 'Start rotation' }).tap()
  await mobile.getByRole('button', { name: 'Stop rotation' }).waitFor()
  await present(mobile)
  await mobile.screenshot({
    path: path.join(out, 'mobile.png'),
    fullPage: true,
  })
  report.mobile = geometry
  await mobile.close()
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport)
    await page.getByLabel('Scene', { exact: true }).selectOption('compute')
    await page.getByRole('button', { name: 'Rebuild same GPU flame' }).click()
    const layout = await page.evaluate(() => {
      const controls = document
        .querySelector('.controls')!
        .getBoundingClientRect()
      const diagnostics = document
        .querySelector('.diagnostics')!
        .getBoundingClientRect()
      const footer = document.querySelector('footer')!.getBoundingClientRect()
      const music = document
        .querySelector('.music-controls')!
        .getBoundingClientRect()
      return {
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        panelsOverlap:
          controls.left < diagnostics.right &&
          controls.right > diagnostics.left &&
          controls.top < diagnostics.bottom &&
          controls.bottom > diagnostics.top,
        footerOverlapsControls: footer.top < controls.bottom,
        footerOverlapsMusic: footer.top < music.bottom,
        musicOverlapsDiagnostics: music.bottom > diagnostics.top,
      }
    })
    assert.ok(layout.scroll <= layout.width)
    assert.equal(layout.panelsOverlap, false)
    assert.equal(layout.footerOverlapsControls, false)
    assert.equal(layout.footerOverlapsMusic, false)
    assert.equal(layout.musicOverlapsDiagnostics, false)
    await present()
    await page.screenshot({
      path: path.join(out, `layout-${viewport.width}.png`),
      fullPage: true,
    })
  }
  if (!production) {
    await page.evaluate(() => {
      window.__lumenGpuXr!.loseDeviceForTest()
    })
    await page
      .getByRole('alert')
      .filter({ hasText: 'GPU device lost' })
      .waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Enter WebGPU VR' }).isDisabled(),
      true,
    )
    assert.equal((await read()).ready, false)
  }
  assert.deepEqual(errors, [])
  report.passed = true
  console.info(
    JSON.stringify({
      passed: true,
      production,
      nativeHeadsetTested: false,
      out,
    }),
  )
} catch (error) {
  report.passed = false
  report.failure = String(error)
  report.last = await read().catch(() => null)
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  await browser.close()
}
