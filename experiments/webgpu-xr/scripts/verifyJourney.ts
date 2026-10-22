// Desktop journey proof uses genuine input with controlled RAF; it is not headset or performance acceptance.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { JOURNEY_STORAGE_KEY, parseJourneyProgress, } from '../src/journey/progress'
import { BRIDGE_TARGET } from '../src/observatory/encounter'
import { GLASS_NOTES } from '../src/observatory/glasswakeEncounter'
import { PASSAGE_DURATION_MS } from '../src/observatory/passage'
import type { BrowserContext, Locator, Page } from 'playwright'
import type { JourneyProgress } from '../src/journey/progress'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
assert.ok(
  process.env.VERIFY_OUT_DIR,
  'Set VERIFY_OUT_DIR to admitted evidence storage',
)
const out = path.resolve(process.env.VERIFY_OUT_DIR)
await mkdir(out, { recursive: true })
const errors: string[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  nativeHeadsetTested: false,
  timing:
    'Real mouse, keyboard and CDP touch input on hardware WebGPU. Controlled 32 ms RAF steps avoid hidden-window throttling; Web Audio runs in real time. This is functional desktop proof, not a performance measurement.',
  audioEvidence:
    'Silence is observed from the shared audio owner after all transports stop. Pitch values are commanded MIDI, not measured singing accuracy or a listening-quality assessment.',
}
let activePage: Page | undefined
let browserProcessId: number | undefined

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
      (monitor: { id: number; specialWorkspace: { name: string } }) => [
        monitor.id,
        monitor.specialWorkspace.name,
      ],
    ),
    clients: get('clients').map(
      (client: {
        address: string
        class: string
        pid: number
        workspace: { name: string }
      }) => ({
        address: client.address,
        class: client.class,
        pid: client.pid,
        workspace: client.workspace.name,
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
    ...(process.env.VERIFY_X11 === '1' ? ['--ozone-platform=x11'] : []),
    ...(process.env.VERIFY_WAYLAND === '1' ? ['--ozone-platform=wayland'] : []),
  ],
})

function checkPlacement(windowsExpected = true) {
  const current = desktop()
  const owned = current.clients.filter(
    (client: { pid: number }) => client.pid === browserProcessId,
  )
  if (!windowsExpected) {
    assert.equal(
      owned.length,
      0,
      'Closing all owned contexts must remove their windows',
    )
    assert.deepEqual(current.special, before.special)
    report.browserCleanup = {
      ownedWindowsClosed: true,
      specialWorkspaceUnchanged: true,
    }
    return
  }
  assert.ok(owned.length > 0, 'Owned Chrome window must be identifiable')
  assert.ok(
    owned.every(
      (client: { class: string; workspace: string }) =>
        client.class === 'agent-browser' &&
        client.workspace === 'special:agents',
    ),
  )
  assert.ok(
    !owned.some(
      (client: { address: string }) => client.address === current.active,
    ),
  )
  assert.deepEqual(current.special, before.special)
  report.browserPlacement = {
    hiddenAgentWorkspace: true,
    ownedProcessId: browserProcessId,
    foregroundUnchanged:
      current.active === before.active &&
      current.workspace === before.workspace,
    note: 'Only the owned browser process is checked. User changes between other foreground apps are recorded rather than rejected. No desktop window titles or unrelated URLs are retained.',
  }
}

const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const almanacButton = (page: Page) =>
  page.getByRole('button', { name: /^Almanac, [0-2] of 2 pages earned$/ })
const scene = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
const sound = (page: Page) =>
  page.evaluate(() => window.__observatory!.audio.snapshot())
const glass = (page: Page) =>
  page.evaluate(() => ({
    ...window.__glasswake!.state,
    cooling: window.__glasswake!.cooling,
  }))
const trace = (page: Page) =>
  page.evaluate(() => window.__observatory!.encounter)
const panel = (page: Page, name: string) =>
  page.locator(`.journey-dialog[data-panel="${name}"]`)

async function poll<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  reason: string,
  timeout = 5000,
) {
  const deadline = Date.now() + timeout
  let value = await read()
  while (!accepts(value) && Date.now() < deadline) {
    await delay(100)
    value = await read()
  }
  assert.ok(accepts(value), `${reason}: ${JSON.stringify(value)}`)
  return value
}

async function advance(page: Page, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 32)
    await page.clock.runFor(Math.min(32, milliseconds - elapsed))
}

async function arrive(page: Page) {
  if ((await scene(page)).passage.active)
    await advance(page, PASSAGE_DURATION_MS + 32)
  assert.equal(
    (await scene(page)).passage.active,
    false,
    'The instrument must be stationary before input',
  )
}

const silent = (page: Page) =>
  poll(
    () => sound(page),
    (value) =>
      !value.error &&
      !value.playing &&
      !value.loading &&
      !value.trace.active &&
      !value.trace.pending &&
      !value.effect.active &&
      !value.effect.pending &&
      value.level === 0,
    'All sound must remain stopped',
  )

async function ready(page: Page) {
  await poll(
    () =>
      page.evaluate(() =>
        Boolean(
          window.__observatory?.runtime.snapshot().ready ||
          window.__observatory?.runtime.snapshot().error,
        ),
      ),
    Boolean,
    'Scene must initialize',
    60000,
  )
  const value = await scene(page)
  assert.equal(value.ready, true, value.error)
  assert.ok(!/swiftshader|llvmpipe/i.test(value.adapter), value.adapter)
  await poll(
    () => scene(page),
    (value) => value.assets.every((asset) => asset.status === 'ready'),
    'All authored scene assets must load',
    30000,
  )
  report.adapter = value.adapter
}

async function observe(context: BrowserContext) {
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.detach()
  report.focus =
    'CDP focus emulation keeps the hidden automation surface active; native tab visibility is not established.'
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(message.text())
  })
  await page.clock.install()
  return page
}

async function pause(page: Page) {
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(new Date(now + 100))
}

async function capture(page: Page, name: string) {
  const before = await page.evaluate(
    () => window.__observatory?.runtime.snapshot().frame.submissions ?? null,
  )
  await advance(page, 160)
  await delay(120)
  await advance(page, 32)
  if (before !== null) {
    const after = await page.evaluate(
      () => window.__observatory!.runtime.snapshot().frame.submissions,
    )
    assert.ok(
      after > before,
      'A capture must follow an actual WebGPU submission',
    )
  }
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 15000 })
}

async function hitTarget(control: Locator) {
  await control.scrollIntoViewIfNeeded()
  const result = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    const center = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    )
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      inViewport:
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.right <= window.innerWidth + 1 &&
        rect.bottom <= window.innerHeight + 1,
      hitsSelf:
        center === element || Boolean(center && element.contains(center)),
      color: style.color,
      background: style.backgroundColor,
      border: style.borderStyle,
      font: style.fontFamily,
      padding: style.padding,
    }
  })
  assert.ok(result.width >= 32 && result.height >= 32, JSON.stringify(result))
  assert.equal(result.inViewport, true, JSON.stringify(result))
  assert.equal(result.hitsSelf, true, JSON.stringify(result))
  return result
}

async function finishGlass(page: Page) {
  await arrive(page)
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Home')
  let currentMidi = 60
  for (const [index, note] of GLASS_NOTES.entries()) {
    for (
      let count = 0;
      count < Math.round((note.midi - currentMidi) / 0.25);
      count++
    )
      await page.keyboard.press('ArrowUp')
    currentMidi = note.midi
    await page.keyboard.press('Enter')
    await advance(page, 1056)
    assert.equal((await glass(page)).armed, true)
    assert.equal((await glass(page)).accepted, index, 'Hold alone cannot award')
    await page.keyboard.press('Enter')
    assert.equal((await glass(page)).accepted, index + 1)
    await advance(page, 1600)
  }
}

async function finishBridge(page: Page) {
  await arrive(page)
  if (await button(page, 'Stop phrase').isVisible())
    await button(page, 'Stop phrase').click()
  if (await button(page, 'Trace without sound').isVisible())
    await button(page, 'Trace without sound').click()
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Enter')
  assert.equal((await trace(page)).accepted, 1)
  for (const target of BRIDGE_TARGET.slice(1)) {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const cursor = await page
        .locator('.observatory-keyboard-cursor')
        .boundingBox()
      assert.ok(cursor)
      const projected = await page.evaluate(
        (point) => window.__observatory!.runtime.projectTrace(point),
        target,
      )
      const canvas = await page.locator('canvas').boundingBox()
      assert.ok(canvas)
      const dx =
        projected.x * canvas.width + canvas.x - (cursor.x + cursor.width / 2)
      const dy =
        projected.y * canvas.height + canvas.y - (cursor.y + cursor.height / 2)
      if (Math.hypot(dx, dy) < 7 || (await trace(page)).accepted === 4) break
      const keys = [
        Math.abs(dx) > 4 ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : '',
        Math.abs(dy) > 4 ? (dy > 0 ? 'ArrowDown' : 'ArrowUp') : '',
      ].filter(Boolean)
      for (const key of keys) await page.keyboard.down(key)
      await advance(page, 32)
      for (const key of keys) await page.keyboard.up(key)
      const value = await trace(page)
      assert.ok(value.drawing || value.accepted === 4, JSON.stringify(value))
    }
  }
  assert.equal(
    (await trace(page)).accepted,
    4,
    'Genuine keyboard trace must complete four notes',
  )
}

const saved = (page: Page) =>
  page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key) ?? 'null') as JourneyProgress | null,
    JOURNEY_STORAGE_KEY,
  )
const layouts = [
  { width: 1440, height: 950 },
  { width: 820, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]

async function panelLayouts(page: Page, kind: string, controls: string[]) {
  const samples: unknown[] = []
  for (const size of layouts) {
    await page.setViewportSize(size)
    await advance(page, 128)
    const boxes = []
    for (const name of controls)
      boxes.push({ name, ...(await hitTarget(button(page, name))) })
    const geometry = await panel(page, kind).evaluate((dialog) => ({
      width: dialog.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth ||
        dialog.scrollWidth > dialog.clientWidth + 1,
      focusedInside: dialog.contains(document.activeElement),
      modal: dialog.matches(':modal'),
    }))
    assert.equal(geometry.horizontalOverflow, false)
    assert.equal(geometry.modal, true)
    await panel(page, kind).evaluate((dialog) => {
      dialog.scrollTop = 0
    })
    await capture(page, `${kind}-${size.width}x${size.height}`)
    samples.push({ ...size, controls: boxes, ...geometry })
  }
  await page.setViewportSize(layouts[0])
  await advance(page, 128)
  report[`${kind}Layouts`] = samples
}

async function modalFocus(page: Page, kind: string) {
  const controls = panel(page, kind).locator(
    'button:enabled, input:enabled, a[href]',
  )
  await controls.last().focus()
  await page.keyboard.press('Tab')
  if (
    !(await panel(page, kind).evaluate((dialog) =>
      dialog.contains(document.activeElement),
    ))
  ) {
    assert.equal(
      await page.evaluate(() => document.activeElement === document.body),
      true,
      'Modal navigation must never reach an underlying app control',
    )
    await page.keyboard.press('Tab')
  }
  assert.equal(
    await panel(page, kind).evaluate((dialog) =>
      dialog.contains(document.activeElement),
    ),
    true,
    'Tab must remain inside the modal',
  )
  await controls.first().focus()
  await page.keyboard.press('Shift+Tab')
  if (
    !(await panel(page, kind).evaluate((dialog) =>
      dialog.contains(document.activeElement),
    ))
  ) {
    assert.equal(
      await page.evaluate(() => document.activeElement === document.body),
      true,
      'Reverse modal navigation must never reach an underlying app control',
    )
    await page.keyboard.press('Shift+Tab')
  }
  assert.equal(
    await panel(page, kind).evaluate((dialog) =>
      dialog.contains(document.activeElement),
    ),
    true,
    'Shift+Tab must remain inside the modal',
  )
}

async function touchPractice(page: Page, context: BrowserContext) {
  const range = page.getByRole('slider', {
    name: 'Practice note height',
    exact: true,
  })
  const bounds = await hitTarget(range)
  const session = await context.newCDPSession(page)
  const point = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    id: 1,
  }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...point, y: point.y - 20 }],
  })
  const active = await poll(
    () => sound(page),
    (value) => value.trace.active && value.level > 0.001,
    'Touch practice must make a measured sound',
  )
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await silent(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  })
  await silent(page)
  await session.detach()
  return {
    commandedMidi: active.trace.midi,
    measuredLevel: active.level,
    nativeTouchReleaseStops: true,
    nativeTouchCancelStops: true,
  }
}

async function storageFallback(kind: 'blocked' | 'corrupt' | 'future') {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: layouts[0],
  })
  const original =
    kind === 'corrupt'
      ? '{broken'
      : JSON.stringify({ version: 99, futureField: 'preserve this' })
  if (kind === 'blocked')
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException(
            'Storage disabled for verification',
            'SecurityError',
          )
        },
      })
    })
  else
    await context.addInitScript(
      ({ key, raw }) => {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, raw)
      },
      { key: JOURNEY_STORAGE_KEY, raw: original },
    )
  try {
    const page = await observe(context)
    activePage = page
    assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
    await ready(page)
    await pause(page)
    await silent(page)
    await button(page, 'Visit Glasswake').click()
    await button(page, 'Wake the glass').click()
    await finishGlass(page)
    await button(page, 'Open earned page').click()
    await advance(page, 64)
    assert.ok(await panel(page, 'receipt').isVisible())
    const status = panel(page, 'receipt').locator('[data-save-status]')
    assert.equal(
      await status.getAttribute('data-save-status'),
      kind === 'blocked' ? 'memory' : 'protected',
    )
    const message = await status.innerText()
    if (kind !== 'blocked')
      assert.equal(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          JOURNEY_STORAGE_KEY,
        ),
        original,
      )
    await capture(page, `storage-${kind}`)
    report[`storage${kind}`] = {
      completedGlasswakeWithRealInput: true,
      visibleStatus: message,
      originalPreserved: kind === 'blocked' ? 'No storage available' : true,
    }
    checkPlacement()
  } finally {
    await context.close()
  }
}

async function verify() {
  const browserSession = await browser.newBrowserCDPSession()
  const processes = await browserSession.send('SystemInfo.getProcessInfo')
  browserProcessId = processes.processInfo.find(
    (process) => process.type === 'browser',
  )?.id
  await browserSession.detach()
  assert.ok(browserProcessId)
  report.browserVersion = browser.version()
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: true,
    viewport: layouts[0],
  })
  const page = await observe(context)
  activePage = page
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await ready(page)
  checkPlacement()
  await pause(page)
  assert.ok(await panel(page, 'intro').isVisible())
  await silent(page)
  await panelLayouts(page, 'intro', [
    'Skip introduction',
    'Hear note',
    'Visit Glasswake',
    'Visit Tideweave',
  ])
  await modalFocus(page, 'intro')
  report.onboardingTouch = await touchPractice(page, context)
  const practice = page.getByRole('slider', {
    name: 'Practice note height',
    exact: true,
  })
  await practice.focus()
  await page.keyboard.down('ArrowUp')
  await poll(
    () => sound(page),
    (value) => value.trace.active && value.level > 0.001,
    'Practice arrow key must sound',
  )
  await page.keyboard.up('ArrowUp')
  await silent(page)
  await button(page, 'Visit Glasswake').click()
  assert.ok(!(await panel(page, 'intro').isVisible()))
  assert.equal((await saved(page))?.onboardingCompleted, true)
  assert.equal((await saved(page))?.worlds.glasswake.discovered, true)
  await silent(page)
  await button(page, 'Guide').click()
  await advance(page, 64)
  await page.keyboard.press('Escape')
  assert.ok(!(await panel(page, 'intro').isVisible()))
  assert.equal(
    await button(page, 'Guide').evaluate(
      (element) => document.activeElement === element,
    ),
    true,
    'Escape must restore the Guide opener focus',
  )
  await silent(page)
  report.onboarding = {
    freshVisitOpensGuide: true,
    noAutoplay: true,
    practiceKeyboardStopsOnRelease: true,
    visitCompletesGuide: true,
    escapeRestoresFocus: true,
  }
  console.info('Onboarding, responsive controls and touch passed')

  await button(page, 'Wake the glass').click()
  await arrive(page)
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await advance(page, 288)
  assert.ok((await glass(page)).charge > 0 && (await glass(page)).charge < 1)
  await page.keyboard.press('Escape')
  assert.equal((await saved(page))?.worlds.glasswake.completion, null)
  await silent(page)
  await arrive(page)
  await button(page, 'Wake the glass').click()
  await finishGlass(page)
  const onePage = await saved(page)
  assert.ok(onePage?.worlds.glasswake.completion)
  assert.equal(onePage.worlds.tideweave.completion, null)
  assert.ok(
    !(await panel(page, 'receipt').isVisible()),
    'Completion must leave the shatter visible until the player opens its page',
  )
  await button(page, 'Open earned page').click()
  assert.ok(
    await page
      .getByRole('heading', {
        name: 'Glasswake added to your Almanac',
        exact: true,
      })
      .isVisible(),
  )
  await panelLayouts(page, 'receipt', [
    'Close page',
    'Play Glasswake motif',
    'Continue to Tideweave',
    'Open Almanac',
  ])
  await modalFocus(page, 'receipt')
  await page.keyboard.press('Escape')
  assert.equal(
    await button(page, 'Open earned page').evaluate(
      (element) => document.activeElement === element,
    ),
    true,
    'Receipt Escape must restore its surviving opener',
  )
  await button(page, 'Open earned page').click()
  await button(page, 'Continue to Tideweave').click()
  await arrive(page)
  assert.equal((await scene(page)).selectedWorld, 'tideweave')
  await silent(page)
  report.glasswake = {
    interruptedAttemptAwardsNothing: true,
    earnedByRealKeyboardHoldRelease: true,
    receiptWasExplicit: true,
    transitionSelectsTideweave: true,
    storedPage: onePage.worlds.glasswake.completion,
  }
  console.info('Glasswake earned page and world transition passed')

  await button(page, 'Trace a melody').click()
  await finishBridge(page)
  const both = await saved(page)
  await writeFile(
    path.join(out, 'earned-save.json'),
    `${JSON.stringify(both, null, 2)}\n`,
  )
  assert.ok(
    both?.worlds.glasswake.completion && both.worlds.tideweave.completion,
  )
  await button(page, 'Open earned page').click()
  await button(page, 'Open Almanac').click()
  assert.equal(
    await page.locator('.journey-page[data-status="earned"]').count(),
    2,
  )
  await panelLayouts(page, 'almanac', [
    'Close Almanac',
    'Play Glasswake motif',
    'Visit Glasswake',
    'Play Tideweave motif',
    'Visit Tideweave',
  ])
  await modalFocus(page, 'almanac')
  await button(page, 'Play Tideweave motif').click()
  await poll(
    () => sound(page),
    (value) => value.playing && value.level > 0.001,
    'Earned page motif must replay by explicit action',
  )
  await button(page, 'Stop motif').click()
  await silent(page)
  report.tideweave = {
    earnedByRealKeyboardTrace: true,
    twoEarnedPagesVisible: true,
    explicitMotifReplay: true,
    storedPage: both.worlds.tideweave.completion,
  }
  console.info('Tideweave, both earned pages and motif replay passed')

  await button(page, 'Visit Glasswake').click()
  await arrive(page)
  await button(page, 'Play again').click()
  assert.equal((await glass(page)).accepted, 0)
  assert.deepEqual(
    (await saved(page))?.worlds,
    both.worlds,
    'Replaying cannot erase earned identities',
  )
  await page.keyboard.press('Escape')
  await page.clock.resume()
  assert.equal((await page.reload())?.status(), 200)
  await ready(page)
  await pause(page)
  assert.ok(!(await panel(page, 'intro').isVisible()))
  await silent(page)
  assert.deepEqual((await saved(page))?.worlds, both.worlds)
  await almanacButton(page).click()
  assert.equal(
    await page.locator('.journey-page[data-status="earned"]').count(),
    2,
  )
  await capture(page, 'reload-two-earned-pages')
  await page.clock.resume()
  await page.getByRole('link', { name: 'Open the book', exact: true }).click()
  await poll(
    () =>
      page.evaluate(() => window.__almanac?.runtime.snapshot().ready ?? false),
    Boolean,
    'The existing Blender Almanac must initialize',
    60000,
  )
  await page
    .getByRole('button', { name: /Glasswake/ })
    .first()
    .click()
  assert.equal(await page.locator('main[data-page-status="earned"]').count(), 1)
  assert.ok(
    await page
      .locator('.almanac-collection-state[data-page-status="earned"]')
      .isVisible(),
  )
  await page
    .getByRole('button', { name: /Tideweave/ })
    .first()
    .click()
  assert.equal(await page.locator('main[data-page-status="earned"]').count(), 1)
  assert.ok(
    await page
      .locator('.almanac-collection-state[data-page-status="earned"]')
      .isVisible(),
  )
  const bookSound = await page.evaluate(() =>
    window.__almanac!.audio.snapshot(),
  )
  assert.equal(bookSound.playing, false)
  assert.equal(bookSound.level, 0)
  await page.screenshot({
    path: path.join(out, 'existing-almanac-earned.png'),
    timeout: 15000,
  })
  report.persistence = {
    reloadKeepsBothPages: true,
    replayKeepsBothPages: true,
    noReloadAutoplay: true,
    existingBookSharesBothAwards: true,
    identityBeforeReload: both.worlds,
  }
  await context.close()
  console.info('Replay, reload and existing Almanac persistence passed')
  for (const kind of ['blocked', 'corrupt', 'future'] as const)
    await storageFallback(kind)
  await delay(100)
  checkPlacement(false)
  assert.deepEqual(errors, [])
  report.status = 'passed'
}

async function verifyBuiltUi() {
  assert.ok(
    process.env.VERIFY_EARNED_SAVE,
    'Built UI smoke requires the save earned by the genuine input run',
  )
  const raw = await readFile(process.env.VERIFY_EARNED_SAVE, 'utf8')
  assert.equal(parseJourneyProgress(raw).kind, 'valid')
  const browserSession = await browser.newBrowserCDPSession()
  const processes = await browserSession.send('SystemInfo.getProcessInfo')
  browserProcessId = processes.processInfo.find(
    (process) => process.type === 'browser',
  )?.id
  await browserSession.detach()
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: true,
    viewport: layouts[0],
  })
  await context.addInitScript(
    ({ key, data }) => {
      localStorage.setItem(key, data)
    },
    { key: JOURNEY_STORAGE_KEY, data: raw },
  )
  const page = await observe(context)
  activePage = page
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await button(page, 'Guide').waitFor()
  await poll(
    () => button(page, 'Play again').isEnabled(),
    Boolean,
    'Built journey must finish initialization',
    60000,
  )
  checkPlacement()
  await pause(page)
  await button(page, 'Guide').click()
  await panelLayouts(page, 'intro', [
    'Skip introduction',
    'Hear note',
    'Visit Glasswake',
    'Visit Tideweave',
  ])
  await button(page, 'Skip introduction').click()
  await almanacButton(page).click()
  assert.equal(
    await page.locator('.journey-page[data-status="earned"]').count(),
    2,
  )
  await panelLayouts(page, 'almanac', [
    'Close Almanac',
    'Play Glasswake motif',
    'Visit Glasswake',
    'Play Tideweave motif',
    'Visit Tideweave',
  ])
  await page.keyboard.press('Escape')
  assert.equal(
    await almanacButton(page).evaluate(
      (element) => document.activeElement === element,
    ),
    true,
  )
  await page.setViewportSize(layouts[0])
  await button(page, 'Glasswake').click()
  await delay(750)
  await capture(page, 'built-overview-glasswake')
  await button(page, 'Tideweave').click()
  await delay(250)
  await capture(page, 'built-overview-tideweave')
  const overviewControls: unknown[] = []
  for (const size of layouts) {
    await page.setViewportSize(size)
    await advance(page, 128)
    overviewControls.push({
      ...size,
      guide: await hitTarget(button(page, 'Guide')),
      almanac: await hitTarget(almanacButton(page)),
      encounter: await hitTarget(button(page, 'Play again')),
    })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    )
  }
  report.builtOverviewControls = overviewControls
  await page.setViewportSize(layouts[0])
  await almanacButton(page).click()
  await page.clock.resume()
  await page.getByRole('link', { name: 'Open the book', exact: true }).click()
  await poll(
    () => button(page, 'Clay view').isEnabled(),
    Boolean,
    'Built Blender book must finish loading',
    60000,
  )
  await pause(page)
  const bookLayouts: unknown[] = []
  for (const size of [layouts[1], layouts[2]]) {
    await page.setViewportSize(size)
    await advance(page, 128)
    const returnLink = page.getByRole('link', {
      name: 'Return to worlds',
      exact: true,
    })
    const returnBounds = await hitTarget(returnLink)
    assert.equal(
      await returnLink.getAttribute('href'),
      '/observatory?world=tideweave',
    )
    await capture(page, `built-book-header-${size.width}x${size.height}`)
    const earned = page.locator(
      '.almanac-collection-state[data-page-status="earned"]',
    )
    await earned.scrollIntoViewIfNeeded()
    const stateBounds = await earned.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        x: rect.x,
        width: rect.width,
        y: rect.y,
        bottom: rect.bottom,
        inBounds:
          rect.left >= 0 &&
          rect.right <= window.innerWidth + 1 &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight + 1,
        horizontalOverflow:
          document.documentElement.scrollWidth > window.innerWidth,
      }
    })
    assert.equal(stateBounds.inBounds, true)
    assert.equal(stateBounds.horizontalOverflow, false)
    await capture(page, `built-book-earned-${size.width}x${size.height}`)
    bookLayouts.push({
      ...size,
      returnControl: returnBounds,
      earnedStatus: stateBounds,
    })
  }
  await page.clock.resume()
  await page
    .getByRole('link', { name: 'Return to worlds', exact: true })
    .click()
  await poll(
    () => page.locator('main.observatory').getAttribute('data-world'),
    (value) => value === 'tideweave',
    'Book return must preserve selected world',
  )
  report.builtBook = {
    layouts: bookLayouts,
    actualReturnLinkPreservesTideweave: true,
  }
  assert.deepEqual(errors, [])
  report.scope =
    'Built Vite preview UI and emitted CSS smoke. Uses the valid two-page save earned by the separate dev-server input run; no gameplay or audio-performance claim is added by this smoke.'
  report.browserVersion = browser.version()
  report.status = 'passed'
  await context.close()
  await delay(100)
  checkPlacement(false)
}

try {
  if (process.env.VERIFY_BUILT_UI === '1') await verifyBuiltUi()
  else await verify()
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  if (activePage && !activePage.isClosed()) {
    report.failureUrl = activePage.url()
    await activePage
      .screenshot({ path: path.join(out, 'failure.png'), timeout: 15000 })
      .catch(() => undefined)
  }
  throw error
} finally {
  report.errors = errors
  await writeFile(
    path.join(out, 'journey-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await browser.close()
}
