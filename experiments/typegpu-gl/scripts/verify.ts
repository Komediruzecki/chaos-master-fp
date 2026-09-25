// Standalone headed browser proof; never uses the app's SwiftShader test config.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const base = process.env.VERIFY_BASE_URL ?? 'http://127.0.0.1:5186'
const out = path.resolve(
  process.env.VERIFY_OUT_DIR ?? '../../webgpu-verify-out/typegpu-gl',
)
await mkdir(out, { recursive: true })
const launchArgs = [
  '--class=agent-browser',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
]
const browser = await chromium.launch({ headless: false, args: launchArgs })
const errors: string[] = []
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /computations created outside/.test(message.text())
    )
      errors.push(message.text())
  })
  const response = await page.goto(base, { waitUntil: 'networkidle' })
  assert.equal(response?.status(), 200)
  await page.waitForFunction(
    () => window.__glSpike?.error || (window.__glSpike?.cloud?.frames ?? 0) > 5,
  )
  const result = await page.evaluate(() => window.__glSpike)
  await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true })
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(
      { testedAt: new Date().toISOString(), base, launchArgs, errors, result },
      null,
      2,
    ),
  )
  assert.ok(result, 'The app must expose a verification result')
  assert.equal(result.error, undefined, result.error)
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.ok(result.probes.length >= 12)
  assert.ok(
    result.probes.every((probe) => probe.passed),
    JSON.stringify(result.probes.filter((probe) => !probe.passed)),
  )
  assert.equal(result.cloud?.pointCount, 16384)
  assert.ok(
    !/swiftshader|llvmpipe/i.test(String(result.renderer)),
    `Software renderer is not hardware evidence: ${result.renderer}`,
  )
  await page.getByRole('button', { name: 'Pause orbit' }).click()
  const canvas = page.locator('canvas')
  const hash = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex')
  // A frame boundary flushes the pause handler before comparing the image.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => {
            resolve()
          }),
        ),
      ),
  )
  const pausedA = hash(await canvas.screenshot())
  const pausedB = hash(await canvas.screenshot())
  assert.equal(pausedA, pausedB, 'Paused cloud should be stable')
  await page.getByRole('button', { name: 'Resume orbit' }).click()
  const frame = await page.evaluate(() => window.__glSpike?.cloud?.frames ?? 0)
  await page.waitForFunction(
    (previous) => (window.__glSpike?.cloud?.frames ?? 0) > previous + 20,
    frame,
  )
  const moving = hash(await canvas.screenshot())
  assert.notEqual(moving, pausedA, 'Orbit should alter the rendered image')
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        base,
        launchArgs,
        errors,
        result,
        controls: { pauseStable: true, orbitChangesImage: true },
      },
      null,
      2,
    ),
  )
  console.info(
    JSON.stringify({
      passed: true,
      renderer: result.renderer,
      checks: result.probes.length,
      pointCount: result.cloud?.pointCount,
      out,
    }),
  )
} finally {
  await browser.close()
}
