// Standalone headed hardware verification; no SwiftShader or WebXR emulator.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
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
const page = await browser.newPage({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 950 },
})
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
const frames = async (count = 4) => {
  const start = (await read()).submissions ?? 0
  await page.waitForFunction(
    (start) => (window.__lumenGpuXr?.snapshot().submissions ?? 0) >= start,
    start + count,
  )
}
try {
  assert.equal(
    (await page.goto(base, { waitUntil: 'networkidle' }))?.status(),
    200,
  )
  await page.getByRole('button', { name: 'Hold motion' }).waitFor()
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>('.button-row button')
        ?.disabled,
  )
  await page.getByRole('button', { name: 'Hold motion' }).click()
  if (!production) {
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
    const before = await page.evaluate(() => window.__lumenGpuXr!.readPoints())
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
      await page.evaluate(() => window.__lumenGpuXr!.readPoints()),
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
    await page.evaluate(() => window.__lumenGpuXr!.stepForTest())
    assert.notDeepEqual(
      await page.evaluate(() => window.__lumenGpuXr!.readPoints()),
      before,
      'Actual GPU dispatch must change stored particle positions',
    )
    const generation = (await read()).generation!
    await page.getByRole('button', { name: 'Resume motion' }).click()
    await page.waitForFunction(
      (generation) =>
        (window.__lumenGpuXr?.snapshot().generation ?? 0) > generation + 30,
      generation,
      // Hyprland's off-workspace window can throttle rAF to 1 Hz even with
      // Chromium's background switches. Preserve the 30-step assertion.
      { timeout: 60000 },
    )
    await page.getByRole('button', { name: 'Hold motion' }).click()
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
  } else
    assert.equal(
      await page.evaluate(() => '__lumenGpuXr' in window),
      false,
      'Production must not expose debug hooks',
    )
  await page.getByLabel('Scene', { exact: true }).selectOption('probe')
  if (!production) await frames()
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
  await mobile.getByRole('button', { name: 'Hold motion' }).tap()
  await mobile.getByRole('button', { name: 'Resume motion' }).waitFor()
  await mobile.screenshot({
    path: path.join(out, 'mobile.png'),
    fullPage: true,
  })
  report.mobile = geometry
  await mobile.close()
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
