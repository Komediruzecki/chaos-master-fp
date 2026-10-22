// Bounded hardware-browser evidence for desktop scene passages and interrupted navigation.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { createJourneyStore, JOURNEY_STORAGE_KEY, } from '../src/journey/progress'
import type { BrowserContext, Page } from 'playwright'
import type { ObservatoryView } from '../src/observatory/scene'

const admitted = process.env.VERIFY_OUT_DIR
assert.ok(admitted, 'Set VERIFY_OUT_DIR to an admitted run evidence directory')
const out = path.join(admitted, 'passages')
const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
const errors: string[] = []
const captures: unknown[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  status: 'running',
  errors,
  captures,
  nativeHeadsetTested: false,
  fixture:
    'Onboarding and both earned pages are seeded with the current progress-store API for art and navigation inspection only. This proof does not claim genuine encounter completion or page earning.',
  scope:
    'Real buttons and trusted pointer/keyboard events exercise scene handoffs. Explicitly labelled runtime diagnostics test replacement and motion-off contracts. Short desktop samples are not headset, native visibility or sustained performance acceptance.',
}
const store = createJourneyStore({ worlds: ALMANAC_WORLDS })
store.completeOnboarding()
store.completeWorld('glasswake')
store.completeWorld('tideweave')
const fixture = store.read().progress
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

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
const foreground = process.env.HYPRLAND_INSTANCE_SIGNATURE
  ? desktop()
  : undefined
const browser = await chromium.launch({
  headless: false,
  env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
  args: [
    '--class=agent-browser',
    ...(process.env.VERIFY_WAYLAND === '1' ? ['--ozone-platform=wayland'] : []),
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
})
let currentPage: Page | undefined
const state = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const audio = (page: Page) =>
  page.evaluate(() => window.__observatory!.audio.snapshot())

async function context(reducedMotion: 'reduce' | 'no-preference') {
  const value = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion,
    viewport: { width: 1440, height: 950 },
  })
  value.setDefaultTimeout(30000)
  await value.addInitScript(
    ({ key, progress }) => {
      localStorage.setItem(key, JSON.stringify(progress))
    },
    { key: JOURNEY_STORAGE_KEY, progress: fixture },
  )
  return value
}

async function open(context: BrowserContext) {
  const page = await context.newPage()
  currentPage = page
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /computations created outside|GPU validation|device lost/i.test(
        message.text(),
      )
    )
      errors.push(message.text())
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.detach()
  report.focus =
    'CDP focus emulation keeps the hidden automation surface active; this is not native tab-visibility proof.'
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await page.waitForFunction(
    () => {
      const value = window.__observatory?.runtime.snapshot()
      return (
        value?.error ||
        (value?.ready &&
          value.assets.every((asset) => asset.status === 'ready') &&
          value.bookDetail.status === 'ready' &&
          value.sceneDetail.status === 'ready' &&
          value.frame.submissions > 3)
      )
    },
    undefined,
    { timeout: 60000 },
  )
  const snapshot = await state(page)
  assert.ok(snapshot.ready, snapshot.error)
  assert.deepEqual(snapshot.errors, [])
  assert.ok(!/swiftshader|llvmpipe/i.test(snapshot.adapter), snapshot.adapter)
  assert.equal(snapshot.frame.generations, 2)
  await settled(page, 'overview')
  return page
}

async function placement() {
  if (!foreground) return
  const cdp = await browser.newBrowserCDPSession()
  const processes = await cdp.send('SystemInfo.getProcessInfo')
  const pid = processes.processInfo.find(
    (entry) => entry.type === 'browser',
  )?.id
  await cdp.detach()
  assert.ok(pid)
  const clients = JSON.parse(
    execFileSync('hyprctl', ['-j', 'clients'], { encoding: 'utf8' }),
  ) as {
    pid: number
    address: string
    class: string
    workspace: { name: string }
  }[]
  const owned = clients.filter((client) => client.pid === pid)
  assert.ok(
    owned.length &&
      owned.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace.name === 'special:agents',
      ),
    JSON.stringify(owned),
  )
  const current = desktop()
  assert.deepEqual(current.special, foreground.special)
  assert.ok(!owned.some((client) => client.address === current.active))
  report.placement = {
    hiddenAgentWorkspace: true,
    foregroundUnchanged: JSON.stringify(current) === JSON.stringify(foreground),
    note: 'User foreground changes are recorded; owned browser windows must stay hidden and unfocused.',
    pid,
  }
}

async function settled(page: Page, view: ObservatoryView) {
  await page.waitForFunction((expected) => {
    const value = window.__observatory!.runtime.snapshot()
    return (
      value.view === expected &&
      !value.passage.active &&
      value.passage.scene.view === expected
    )
  }, view)
  await page.waitForFunction(
    () =>
      document
        .querySelector('main.observatory')
        ?.getAttribute('data-passage') === 'idle',
  )
  assert.equal((await state(page)).passage.arrival, 0)
  assert.equal((await state(page)).passage.opacity, 0)
  assert.equal(await page.locator('.observatory-passage').isVisible(), false)
}

async function active(page: Page) {
  await page.waitForFunction(
    () => window.__observatory!.runtime.snapshot().passage.active,
  )
  assert.equal(await page.locator('canvas').getAttribute('aria-busy'), 'true')
  assert.equal(await page.locator('.observatory-loading').count(), 0)
}

async function capture(page: Page, name: string) {
  const before = await state(page)
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))
  assert.equal(layout.overflow, false)
  await page.screenshot({ path: path.join(out, `${name}.png`) })
  captures.push({ name, layout, before, after: await state(page) })
}

async function crest(page: Page, name: string) {
  await page.waitForFunction(
    () => window.__observatory!.runtime.snapshot().passage.opacity > 0.95,
    undefined,
    { polling: 'raf', timeout: 5000 },
  )
  await capture(page, name)
}

async function silent(page: Page) {
  await page.waitForFunction(() => {
    const value = window.__observatory!.audio.snapshot()
    return (
      !value.playing &&
      !value.loading &&
      !value.trace.active &&
      !value.trace.pending &&
      !value.effect.active
    )
  })
  assert.equal((await audio(page)).playing, false)
}

async function identity(page: Page) {
  return page.evaluate(async () => {
    const hashes: Record<string, string> = {}
    for (const id of ['glasswake', 'tideweave'] as const) {
      const points = await window.__observatory!.runtime.readPoints(id, 256)
      const digest = await window.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(points)),
      )
      hashes[id] = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('')
    }
    return hashes
  })
}

function retained(snapshot: Awaited<ReturnType<typeof state>>) {
  return {
    generations: snapshot.frame.generations,
    livePoints: snapshot.frame.livePoints,
    bufferBytes: snapshot.frame.bufferBytes,
    bookDetail: snapshot.bookDetail,
    sceneDetail: snapshot.sceneDetail,
  }
}

async function returnToWorlds(page: Page) {
  await button(page, 'Return to worlds').click()
  await settled(page, 'overview')
  await silent(page)
}

async function warmAllScenes(page: Page) {
  await button(page, 'Play again').click()
  await settled(page, 'glasswake')
  await returnToWorlds(page)
  await button(page, 'Tideweave').click()
  await button(page, 'Play again').click()
  await settled(page, 'trace')
  await returnToWorlds(page)
  await button(page, 'Open temple signal').click()
  await settled(page, 'temple')
  await returnToWorlds(page)
  await button(page, 'Glasswake').click()
  report.resourceWarmup =
    'Each scene visited with real controls before comparing retained allocations; lazily created scene passes are included in the baseline.'
}

async function checkGlassInput(page: Page) {
  await button(page, 'Play again').click()
  await active(page)
  const pad = page.getByRole('slider', { name: 'Crystal pitch instrument' })
  assert.equal(await pad.getAttribute('aria-disabled'), 'true')
  await pad.focus()
  await page.keyboard.press('Enter')
  const box = await pad.boundingBox()
  assert.ok(box)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const during = await page.evaluate(() => ({
    passage: window.__observatory!.runtime.snapshot().passage,
    encounter: window.__glasswake!.state,
  }))
  assert.ok(during.passage.active, 'Input must be delivered during the passage')
  assert.equal(during.encounter.accepted, 0)
  assert.equal(during.encounter.holding, false)
  await crest(page, 'glasswake-passage-crest')
  await settled(page, 'glasswake')
  assert.equal(await pad.getAttribute('aria-disabled'), 'false')
  await capture(page, 'glasswake-arrival')
  report.glassInput = {
    trustedKeyboardAndPointer: true,
    during,
    acceptedAfter: await page.evaluate(
      () => window.__glasswake!.state.accepted,
    ),
  }
  await returnToWorlds(page)
}

async function checkTideInterruption(page: Page) {
  await button(page, 'Tideweave').click()
  await button(page, 'Play again').click()
  await active(page)
  await page.locator('canvas').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowRight')
  const box = await page.locator('canvas').boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45)
  await page.mouse.up()
  const during = await page.evaluate(() => ({
    passage: window.__observatory!.runtime.snapshot().passage,
    accepted: window.__observatory!.encounter.accepted,
    drawing: window.__observatory!.encounter.drawing,
  }))
  assert.ok(
    during.passage.active,
    'Trace input must be delivered during the passage',
  )
  assert.equal(during.accepted, 0)
  assert.equal(during.drawing, false)
  await page.keyboard.press('Escape')
  await settled(page, 'overview')
  await delay(800)
  await silent(page)
  assert.equal(
    (await page.evaluate(() => window.__observatory!.encounter)).accepted,
    0,
  )
  report.tideInputAndEscape = {
    trustedKeyboardAndPointer: true,
    during,
    pendingMotifCancelled: true,
  }

  await button(page, 'Play again').click()
  await active(page)
  await button(page, 'Guide').click()
  await page.locator('dialog[data-panel="intro"][open]').waitFor()
  assert.equal((await state(page)).passage.active, false)
  await delay(800)
  await silent(page)
  await page.keyboard.press('Escape')
  await page
    .locator('dialog[data-panel="intro"][open]')
    .waitFor({ state: 'hidden' })
  await settled(page, 'trace')
  await capture(page, 'tideweave-arrival-after-guide')
  await returnToWorlds(page)
  report.guideInterruption = {
    settlesPassage: true,
    pendingMotifCancelled: true,
    escapeClosesGuide: true,
  }
}

async function simulatedInterruptions(page: Page) {
  const before = await page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key)!)
    return [
      value.worlds.glasswake.completion,
      value.worlds.tideweave.completion,
    ]
  }, JOURNEY_STORAGE_KEY)
  await button(page, 'Tideweave').click()
  await button(page, 'Play again').click()
  await active(page)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await settled(page, 'trace')
  await delay(800)
  await silent(page)
  const blurred = await state(page)
  await returnToWorlds(page)

  await button(page, 'Play again').click()
  await active(page)
  const hidden = await page.evaluate(() => {
    Object.defineProperty(document, '__passageHiddenDescriptor', {
      configurable: true,
      value: Object.getOwnPropertyDescriptor(document, 'hidden'),
    })
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    return window.__observatory!.runtime.snapshot()
  })
  try {
    assert.equal(hidden.active, false)
    assert.equal(hidden.passage.active, false)
    assert.equal(hidden.passage.scene.view, 'trace')
    await delay(800)
    await silent(page)
  } finally {
    await page.evaluate(() => {
      const descriptor = Reflect.get(document, '__passageHiddenDescriptor') as
        | PropertyDescriptor
        | undefined
      if (descriptor) Object.defineProperty(document, 'hidden', descriptor)
      else Reflect.deleteProperty(document, 'hidden')
      Reflect.deleteProperty(document, '__passageHiddenDescriptor')
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  await settled(page, 'trace')
  await delay(800)
  await silent(page)
  const restored = await state(page)
  assert.equal(restored.active, true)
  const after = await page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key)!)
    return [
      value.worlds.glasswake.completion,
      value.worlds.tideweave.completion,
    ]
  }, JOURNEY_STORAGE_KEY)
  assert.deepEqual(after, before)
  await returnToWorlds(page)
  report.simulatedInterruptions = {
    note: 'Synthetic window blur and a temporary document.hidden override exercise cancellation handlers only. This is not native tab, window-focus or headset visibility acceptance.',
    openedByRealButtons: true,
    blurred: blurred.passage,
    hidden: { active: hidden.active, passage: hidden.passage },
    restored: { active: restored.active, passage: restored.passage },
    pendingAudioCancelled: true,
    noRestartAfterRestore800ms: true,
    earnedFixtureCompletionsUnchanged: true,
  }
}

async function checkAtlasBookTemple(page: Page) {
  await button(page, 'Inspect orb').click()
  await crest(page, 'tideweave-inspect-passage-crest')
  await settled(page, 'inspect')
  await capture(page, 'tideweave-inspect-arrival')
  await page.keyboard.press('Escape')
  await settled(page, 'overview')
  await page.getByRole('button', { name: /^Almanac, / }).click()
  await page.locator('dialog[data-panel="almanac"][open]').waitFor()
  await button(page, 'Visit Glasswake').click()
  await settled(page, 'overview')
  assert.equal((await state(page)).selectedWorld, 'glasswake')
  await button(page, 'Open temple signal').click()
  await crest(page, 'temple-passage-crest')
  await settled(page, 'temple')
  await silent(page)
  assert.equal((await state(page)).visual.temple.progress, 0)
  assert.equal((await state(page)).visual.temple.revealed, false)
  await capture(page, 'temple-silent-arrival')
  await returnToWorlds(page)
  report.bookAndTemple = {
    almanacVisit: true,
    silentTempleArrival: true,
    noAutomaticReveal: true,
  }
}

async function diagnosticContracts(page: Page) {
  await page.evaluate(() => {
    const runtime = window.__observatory!.runtime
    runtime.navigate('glasswake', 'glasswake')
    runtime.navigate('trace', 'tideweave')
    runtime.navigate('temple', 'tideweave')
  })
  await settled(page, 'temple')
  const replaced = await state(page)
  assert.deepEqual(replaced.passage.target, {
    view: 'temple',
    worldId: 'tideweave',
  })
  await page.evaluate(() => {
    window.__observatory!.runtime.navigate('overview', 'glasswake')
  })
  await settled(page, 'overview')
  await page.evaluate(() => {
    window.__observatory!.runtime.navigate('inspect', 'glasswake')
  })
  await active(page)
  await page.evaluate(() => {
    window.__observatory!.runtime.setMotion(false)
  })
  await settled(page, 'inspect')
  const paused = await state(page)
  assert.equal(paused.motion, false)
  const first = await page
    .locator('canvas')
    .screenshot({ path: path.join(out, 'diagnostic-paused-a.png') })
  await delay(700)
  const second = await page
    .locator('canvas')
    .screenshot({ path: path.join(out, 'diagnostic-paused-b.png') })
  assert.equal(
    hash(first),
    hash(second),
    'Motion-off canvas must settle immediately',
  )
  await page.evaluate(() => {
    window.__observatory!.runtime.navigate('overview', 'glasswake')
    window.__observatory!.runtime.setMotion(true)
  })
  await settled(page, 'overview')
  report.runtimeDiagnostics = {
    note: 'Direct runtime API exercises replacement and motion settlement; these are not claims of UI navigation or earned encounter progress.',
    latestTargetWins: true,
    replaced: replaced.passage,
    motionOffSettles: true,
    paused: paused.passage,
    pausedCanvasHash: hash(first),
  }
}

async function portrait(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await button(page, 'Play again').click()
  await settled(page, 'glasswake')
  await capture(page, 'glasswake-arrival-portrait')
  await returnToWorlds(page)
  await button(page, 'Tideweave').click()
  await button(page, 'Play again').click()
  await settled(page, 'trace')
  if (await button(page, 'Stop phrase').isVisible())
    await button(page, 'Stop phrase').click()
  await capture(page, 'tideweave-arrival-portrait')
  await returnToWorlds(page)
  await button(page, 'Open temple signal').click()
  await settled(page, 'temple')
  await capture(page, 'temple-arrival-portrait')
  await returnToWorlds(page)
  await page.setViewportSize({ width: 1440, height: 950 })
}

async function reducedMotion(context: BrowserContext) {
  const page = await open(context)
  assert.equal((await state(page)).motion, false)
  await button(page, 'Play again').click()
  await settled(page, 'glasswake')
  await capture(page, 'reduced-motion-glasswake')
  await returnToWorlds(page)
  await button(page, 'Inspect orb').click()
  await settled(page, 'inspect')
  await page.keyboard.press('Escape')
  await settled(page, 'overview')
  await button(page, 'Open temple signal').click()
  await settled(page, 'temple')
  await silent(page)
  report.reducedMotion = {
    newContextPreference: 'reduce',
    motion: false,
    noVeilAfterNavigation: true,
    noAutomaticTempleAudio: true,
  }
  await page.close()
}

try {
  await mkdir(out, { recursive: true })
  report.browserVersion = browser.version()
  const ordinary = await context('no-preference')
  const page = await open(ordinary)
  await placement()
  report.initial = await state(page)
  const points = await identity(page)
  report.step = 'warm-scene-resources'
  await warmAllScenes(page)
  const baseline = retained(await state(page))
  report.step = 'glasswake-transit-input'
  await checkGlassInput(page)
  report.step = 'tideweave-interruptions'
  await checkTideInterruption(page)
  report.step = 'simulated-blur-and-hidden-interruptions'
  await simulatedInterruptions(page)
  report.step = 'inspect-almanac-temple'
  await checkAtlasBookTemple(page)
  report.step = 'runtime-contract-diagnostics'
  await diagnosticContracts(page)
  report.step = 'portrait-arrivals'
  await portrait(page)
  const final = await state(page)
  assert.deepEqual(retained(final), baseline)
  assert.deepEqual(await identity(page), points)
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    JOURNEY_STORAGE_KEY,
  )
  assert.deepEqual(
    saved.worlds.glasswake.completion,
    fixture.worlds.glasswake.completion,
  )
  assert.deepEqual(
    saved.worlds.tideweave.completion,
    fixture.worlds.tideweave.completion,
  )
  report.retainedResources = {
    baseline,
    final: retained(final),
    pointHashes: points,
    fixtureCompletionsUnchanged: true,
  }
  await placement()
  await page.close()
  await ordinary.close()
  report.step = 'reduced-motion'
  const reduced = await context('reduce')
  await reducedMotion(reduced)
  await reduced.close()
  assert.deepEqual(errors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  report.failureStack = error instanceof Error ? error.stack : undefined
  if (currentPage && !currentPage.isClosed()) {
    report.lastState = await state(currentPage).catch(() => undefined)
    await currentPage
      .screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 })
      .catch(() => undefined)
  }
  process.exitCode = 1
} finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  await writeFile(
    path.join(out, 'passages.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
}
