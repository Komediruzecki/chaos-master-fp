// Matched hardware-WebGPU temple lookdev captures; transport behavior is verified by verifyTemple.ts.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { JOURNEY_STORAGE_KEY, parseJourneyProgress, } from '../src/journey/progress'

assert.ok(process.env.VERIFY_OUT_DIR, 'Set admitted VERIFY_OUT_DIR')
assert.ok(process.env.VERIFY_EARNED_SAVE, 'Set genuine earned save receipt')
const out = path.resolve(process.env.VERIFY_OUT_DIR)
const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
await mkdir(out, { recursive: true })
const fixture = parseJourneyProgress(
  await readFile(process.env.VERIFY_EARNED_SAVE, 'utf8'),
)
assert.equal(fixture.kind, 'valid')
assert.ok(
  fixture.progress.worlds.glasswake.completion &&
    fixture.progress.worlds.tideweave.completion,
)
const errors: string[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  nativeHeadsetTested: false,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  comparison:
    'Canvas bounds including the unchanged overview HUD. DEV renderer state bypasses the ending UI for matched visual comparison only. Fixed 1440x950 CSS viewport, DPR 1, default temple camera, explicit progress and runtime time 12 seconds. A controlled 32 ms RAF advance per sample; actual runtime time is recorded. No performance or real transport claim. The production journey is verified separately through actual UI.',
  fixture: process.env.VERIFY_EARNED_SAVE,
}

function desktop() {
  const get = (name: string) =>
    JSON.parse(
      execFileSync('hyprctl', ['-j', name], {
        encoding: 'utf8',
        timeout: 5000,
      }),
    )
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
      (c: {
        pid: number
        class: string
        address: string
        workspace: { name: string }
      }) => ({
        pid: c.pid,
        class: c.class,
        address: c.address,
        workspace: c.workspace.name,
      }),
    ),
  }
}
const before = desktop()
const browser = await chromium.launch({
  headless: false,
  timeout: 30000,
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
let browserPid: number | undefined
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 950 },
  deviceScaleFactor: 1,
})
await context.addInitScript(
  ({ key, raw }) => {
    localStorage.setItem(key, raw)
  },
  { key: JOURNEY_STORAGE_KEY, raw: JSON.stringify(fixture.progress) },
)
const page = await context.newPage()
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text())
})
const scene = () =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())

function placement(closed = false) {
  const current = desktop()
  const owned = current.clients.filter(
    (c: { pid: number }) => c.pid === browserPid,
  )
  assert.ok(
    current.special.every(
      ([id, name]: [number, string]) =>
        name !== 'special:agents' ||
        before.special.some(
          ([bid, bname]: [number, string]) => bid === id && bname === name,
        ),
    ),
    'Agent workspace must never be revealed',
  )
  if (closed) assert.equal(owned.length, 0)
  else {
    assert.ok(owned.length > 0)
    assert.ok(
      owned.every(
        (c: { class: string; workspace: string }) =>
          c.class === 'agent-browser' && c.workspace === 'special:agents',
      ),
    )
    assert.ok(
      !owned.some((c: { address: string }) => c.address === current.active),
    )
  }
  return {
    hiddenAgentWorkspace: true,
    ownedWindowsClosed: closed,
    foregroundUnchanged:
      current.active === before.active &&
      current.workspace === before.workspace,
  }
}
try {
  const cdp = await browser.newBrowserCDPSession()
  browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(
    (p) => p.type === 'browser',
  )?.id
  await cdp.detach()
  report.browserVersion = browser.version()
  await page.clock.install()
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  const deadline = Date.now() + 60000
  while (
    Date.now() < deadline &&
    !(await page.evaluate(
      () =>
        window.__observatory?.runtime.snapshot().ready ||
        window.__observatory?.runtime.snapshot().error,
    ))
  )
    await delay(100)
  let state = await scene()
  assert.equal(state.ready, true, state.error)
  assert.ok(!/swiftshader|llvmpipe/i.test(state.adapter), state.adapter)
  report.adapter = state.adapter
  report.placement = placement()
  await page.clock.pauseAt(
    new Date((await page.evaluate(() => Date.now())) + 100),
  )
  const assetsDeadline = Date.now() + 30000
  while (
    Date.now() < assetsDeadline &&
    !state.assets.every((asset) => asset.status === 'ready')
  ) {
    await page.clock.runFor(32)
    await delay(64)
    state = await scene()
  }
  assert.ok(state.assets.every((asset) => asset.status === 'ready'))
  await page.evaluate(() => {
    window.__observatory!.runtime.setView('temple')
  })
  const samples = []
  for (const sample of [
    { name: 'progress-0', progress: 0, motion: true },
    { name: 'progress-060', progress: 0.6, motion: true },
    { name: 'progress-1', progress: 1, motion: true },
    { name: 'motion-off-complete', progress: 1, motion: false },
  ]) {
    const previous = (await scene()).frame.submissions
    await page.evaluate(({ progress, motion }) => {
      const runtime = window.__observatory!.runtime
      runtime.setMotion(motion)
      runtime.setTemple({ active: true, progress, revealed: progress === 1 })
      Reflect.set(runtime, 'time', 12)
    }, sample)
    await page.clock.runFor(32)
    await delay(150)
    state = await scene()
    assert.ok(
      state.frame.submissions > previous,
      'Each capture follows a real GPU submission',
    )
    assert.equal(state.visual.temple.progress, sample.progress)
    assert.equal(state.visual.temple.revealed, sample.progress === 1)
    assert.equal(state.view, 'temple')
    await page.locator('canvas').screenshot({
      path: path.join(out, `${sample.name}.png`),
      timeout: 15000,
    })
    samples.push({ ...sample, state })
    if (!sample.motion) {
      const frozenPixels = await readFile(path.join(out, `${sample.name}.png`))
      await page.clock.runFor(480)
      await delay(150)
      const frozenState = await scene()
      const laterPixels = await page
        .locator('canvas')
        .screenshot({ timeout: 15000 })
      assert.equal(
        frozenState.visual.time,
        state.visual.time,
        'Paused motion must freeze scene time',
      )
      assert.deepEqual(
        frozenState.visual.temple,
        state.visual.temple,
        'Paused temple presentation must stay fixed',
      )
      assert.equal(
        frozenState.frame.bufferBytes,
        state.frame.bufferBytes,
        'Static reveal must not grow GPU buffers',
      )
      assert.equal(
        frozenState.frame.generations,
        state.frame.generations,
        'Static reveal must retain fractal points',
      )
      assert.ok(
        frozenPixels.equals(laterPixels),
        'Paused temple pixels must remain identical over 480 ms',
      )
      report.motionOffStability = {
        controlledMilliseconds: 480,
        identicalPngBytes: true,
        sha256: createHash('sha256').update(laterPixels).digest('hex'),
        sceneTime: frozenState.visual.time,
        bufferBytes: frozenState.frame.bufferBytes,
        fractalGenerations: frozenState.frame.generations,
      }
    }
  }
  report.samples = samples
  assert.deepEqual(errors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  report.lastScene = await scene().catch(() => null)
  await page
    .screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 })
    .catch(() => {})
  process.exitCode = 1
} finally {
  report.errors = errors
  await context.close()
  await browser.close()
  try {
    report.cleanup = placement(true)
  } catch (error) {
    report.cleanupFailure = String(error)
    report.status = 'failed'
    process.exitCode = 1
  }
  await writeFile(
    path.join(out, 'temple-polish-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.info(
    JSON.stringify({
      status: report.status,
      failure: report.failure,
      report: path.join(out, 'temple-polish-report.json'),
    }),
  )
}
