// Exercise the real IWSDK/IWER frame loop in hardware-backed headed Chromium.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5187/'
const out = path.resolve(process.env.VERIFY_OUT_DIR ?? 'artifacts')
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
  viewport: { width: 1280, height: 850 },
})
const errors: string[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  args,
  headsetTested: false,
  errors,
}
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (
    message.type() === 'error' ||
    /computations created outside/.test(message.text())
  )
    errors.push(message.text())
})
const read = () => page.evaluate(() => window.__lumenStereo!.snapshot())
const remote = (method: string, params: Record<string, unknown> = {}) =>
  page.evaluate(
    ({ method, params }) => window.IWER_DEVICE!.remote.dispatch(method, params),
    { method, params },
  )

async function select(device: string, count: number) {
  // An off-workspace headed browser may run below 5 Hz. IWER's duration-based
  // select can press and release in one frame there. Observe the actual held
  // state before releasing; do not synthesize an application selection event.
  await remote('set_select_value', { device, value: 1 })
  try {
    await page.waitForFunction(
      (count) => window.__lumenStereo?.snapshot().selections === count,
      count,
    )
  } finally {
    await remote('set_select_value', { device, value: 0 })
  }
}
const frames = async (count = 3) => {
  const start = await page.evaluate(
    () => window.__lumenStereo!.world.renderer.info.render.frame,
  )
  await page.waitForFunction(
    (target) =>
      window.__lumenStereo!.world.renderer.info.render.frame >= target,
    start + count,
  )
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
try {
  assert.equal(
    (await page.goto(base, { waitUntil: 'networkidle' }))?.status(),
    200,
  )
  await page.waitForFunction(
    () => window.__lumenStereo?.snapshot().ready,
    undefined,
    { timeout: 30000 },
  )
  const initial = await read()
  report.initial = initial
  assert.ok(
    !/swiftshader|llvmpipe/i.test(String(initial.renderer)),
    'Must use hardware GL',
  )
  assert.equal(initial.pointCount, 32768)
  assert.ok(
    initial.shader?.includes('sin(pos.x)'),
    'App sinusoidal3D must be resolved into the live material',
  )
  await page.getByRole('button', { name: 'Hold motion' }).click()
  await frames()
  const stopped = await read()
  await frames(10)
  assert.equal(
    (await read()).elapsed,
    stopped.elapsed,
    'Pause must hold the simulation',
  )
  await page.mouse.click(640, 400)
  await page.waitForFunction(
    () => window.__lumenStereo?.snapshot().selections === 1,
  )
  assert.equal(
    (await read()).selected,
    true,
    'Desktop selection must change the flame',
  )
  await page.mouse.click(640, 400)
  await page.waitForFunction(
    () => window.__lumenStereo?.snapshot().selections === 2,
  )
  await page.mouse.move(20, 450)
  await page.screenshot({ path: path.join(out, 'desktop.png') })
  await page.getByRole('button', { name: 'Try stereo VR' }).click()
  await page.waitForFunction(
    () => window.__lumenStereo?.snapshot().eyes.length === 2,
  )
  await remote('set_transform', {
    device: 'headset',
    position: { x: 0, y: 1.6, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  })
  await frames()
  const stereo = await read()
  report.stereo = stereo
  assert.equal(stereo.immersive, true)
  assert.equal(
    stereo.cloudId,
    initial.cloudId,
    'Entering XR must keep the original cloud',
  )
  assert.equal(
    stereo.geometryId,
    initial.geometryId,
    'Both eyes share one point buffer',
  )
  const separation = Math.abs(
    stereo.eyes[0].position[0] - stereo.eyes[1].position[0],
  )
  assert.ok(
    separation > 0.05 && separation < 0.08,
    `Unexpected eye separation: ${separation}`,
  )
  assert.notDeepEqual(stereo.eyes[0].inverse, stereo.eyes[1].inverse)
  assert.notDeepEqual(stereo.eyes[0].viewport, stereo.eyes[1].viewport)
  await page.screenshot({ path: path.join(out, 'stereo.png') })
  console.info('PASS: desktop controls, two tracked eyes and one shared cloud')
  const centerImage = hash(await page.screenshot())
  await remote('set_transform', {
    device: 'headset',
    position: { x: 0.3, y: 1.6, z: 0 },
  })
  await frames()
  const shifted = await read()
  report.shifted = shifted
  assert.deepEqual(
    shifted.center,
    initial.center,
    'Head motion must not move the flame',
  )
  assert.equal(shifted.geometryId, initial.geometryId)
  assert.ok(
    Math.abs(shifted.eyes[0].position[0] - stereo.eyes[0].position[0] - 0.3) <
      0.002,
  )
  assert.notEqual(
    hash(await page.screenshot()),
    centerImage,
    'Head translation must alter the rendered image',
  )
  await remote('set_transform', {
    device: 'headset',
    position: { x: 0, y: 1.6, z: 0 },
  })
  await remote('look_at', {
    device: 'controller-right',
    target: { x: 0, y: 1.6, z: -2.5 },
  })
  await select('controller-right', 3)
  assert.equal(
    (await read()).selected,
    true,
    'Controller trigger must select through IWSDK input',
  )
  await remote('set_input_mode', { mode: 'hand' })
  await remote('look_at', {
    device: 'hand-right',
    target: { x: 0, y: 1.6, z: -2.5 },
  })
  await select('hand-right', 4)
  assert.equal(
    (await read()).selected,
    false,
    'Hand pinch must toggle the same selection',
  )
  await page.screenshot({ path: path.join(out, 'hand-selection.png') })
  const warmed = await read()
  report.warmed = warmed
  console.info('PASS: head parallax, controller trigger and hand pinch')
  await remote('end_session')
  await page.waitForFunction(() => !window.__lumenStereo?.snapshot().immersive)
  await frames()
  await page.getByRole('button', { name: 'Resume motion' }).click()
  const beforeResume = (await read()).elapsed
  await page.waitForFunction(
    (before) => (window.__lumenStereo?.snapshot().elapsed ?? 0) > before + 0.05,
    beforeResume,
  )
  await page.getByRole('button', { name: 'Try stereo VR' }).click()
  await page.waitForFunction(
    () => window.__lumenStereo?.snapshot().eyes.length === 2,
  )
  await page.evaluate(() => {
    window.IWER_DEVICE!.updateVisibilityState('visible-blurred')
  })
  await frames(6)
  const blurred = (await read()).elapsed
  await frames(10)
  assert.equal((await read()).elapsed, blurred, 'Blurred XR must pause motion')
  await page.evaluate(() => {
    window.IWER_DEVICE!.updateVisibilityState('visible')
  })
  await page.waitForFunction(
    (before) => (window.__lumenStereo?.snapshot().elapsed ?? 0) > before + 0.05,
    blurred,
  )
  const reentry = await read()
  report.reentry = reentry
  assert.equal(reentry.geometryId, initial.geometryId)
  assert.equal(
    reentry.resources.geometries,
    warmed.resources.geometries,
    'Reentry must not create another scene after input models are loaded',
  )
  await remote('end_session')
  await page.waitForFunction(() => !window.__lumenStereo?.snapshot().immersive)
  const nativePage = await browser.newPage({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 OculusBrowser/42.0 Quest 3',
  })
  await nativePage.goto(base, { waitUntil: 'networkidle' })
  await nativePage.waitForFunction(() => window.__lumenStereo?.snapshot().ready)
  assert.equal(
    await nativePage.evaluate(() => !!window.IWER_DEVICE),
    false,
    'Quest UA must retain native XR',
  )
  await nativePage.close()
  await page.evaluate(() => {
    window
      .__lumenStereo!.world.renderer.getContext()
      .getExtension('WEBGL_lose_context')!
      .loseContext()
  })
  await page
    .getByRole('alert')
    .filter({ hasText: 'graphics context was lost' })
    .waitFor()
  await page.waitForFunction(() => !window.__lumenStereo?.snapshot().ready)
  assert.equal(
    await page.getByRole('button', { name: 'Try stereo VR' }).isDisabled(),
    true,
  )
  assert.equal(errors.length, 0, errors.join('\n'))
  report.passed = true
  report.checks = [
    'desktop selection',
    'pause and resume',
    'two tracked eyes',
    'shared persistent geometry',
    'world-anchored head parallax',
    'controller trigger',
    'hand pinch',
    'exit and reentry',
    'visibility pause',
    'no emulator on Quest UA',
    'context loss feedback',
  ]
  console.info(
    JSON.stringify({
      passed: true,
      eyeSeparation: separation,
      renderer: initial.renderer,
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
