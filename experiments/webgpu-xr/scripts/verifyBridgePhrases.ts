// Real desktop input verifies authored Tideweave reprises without claiming headset or listening acceptance.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { createJourneyStore, JOURNEY_STORAGE_KEY, } from '../src/journey/progress'
import { BRIDGE_PHRASES, FIRST_BRIDGE_PHRASE, } from '../src/observatory/bridgePhrases'
import type { BrowserContext, Page } from 'playwright'
import type { BridgePhrase } from '../src/observatory/bridgePhrases'

const out = process.env.VERIFY_OUT_DIR
assert.ok(out, 'Set VERIFY_OUT_DIR to admitted evidence storage')
await mkdir(out, { recursive: true })
const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
const phase = process.env.VERIFY_PHASE ?? 'all'
assert.ok(['all', 'practice', 'layout'].includes(phase))
const errors: string[] = []
const captures: unknown[] = []
const inputSamples: unknown[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  status: 'running',
  phase,
  errors,
  captures,
  inputSamples,
  nativeHeadsetTested: false,
  scope:
    'Headed hardware WebGPU with real pointer and keyboard input. Controlled 32 ms RAF steps avoid hidden-window throttling; the clock resumes only for screenshots. Web Audio uses real time. This is not a performance benchmark. Commanded MIDI is not singing accuracy or subjective listening acceptance. Reduced-motion desktop layouts are not tracked-hand or Quest comfort proof.',
}
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const state = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
const sound = (page: Page) =>
  page.evaluate(() => window.__observatory!.audio.snapshot())
const encounter = (page: Page) =>
  page.evaluate(() => window.__observatory!.encounter)
const saved = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    JOURNEY_STORAGE_KEY,
  )
const group = (page: Page) =>
  page.getByRole('group', { name: 'Practice phrases', exact: true })
let activePage: Page | undefined
let browserPid: number | undefined

function step(value: string) {
  report.step = value
  process.stdout.write(`${value}\n`)
}

async function advance(page: Page, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 32)
    await page.clock.runFor(Math.min(32, milliseconds - elapsed))
}

async function pause(page: Page) {
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(new Date(now + 100))
}

async function until<T>(
  page: Page,
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  reason: string,
  timeout = 12000,
) {
  const deadline = Date.now() + timeout
  let value = await read()
  while (!accepts(value) && Date.now() < deadline) {
    await advance(page, 64)
    await delay(50)
    value = await read()
  }
  assert.ok(accepts(value), `${reason}: ${JSON.stringify(value)}`)
  return value
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
const before = process.env.HYPRLAND_INSTANCE_SIGNATURE ? desktop() : undefined
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

function checkPlacement(closed = false) {
  if (!before) return
  const current = desktop()
  const owned = current.clients.filter(
    (client: { pid: number }) => client.pid === browserPid,
  )
  if (closed) assert.equal(owned.length, 0, 'Owned browser windows must close')
  else {
    assert.ok(owned.length > 0)
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
  }
  assert.ok(
    current.special.every(
      (entry: [number, string]) => entry[1] !== 'special:agents',
    ),
    'The agent workspace must not be exposed',
  )
  report[closed ? 'cleanup' : 'placement'] = {
    hiddenAgentWorkspace: true,
    ownedWindowsClosed: closed,
    foregroundUnchanged:
      current.active === before.active &&
      current.workspace === before.workspace,
    specialWorkspaceUnchanged:
      JSON.stringify(current.special) === JSON.stringify(before.special),
    note: 'Unrelated user foreground changes are recorded, not rejected. No workspace was switched or exposed.',
  }
}

async function ready(page: Page) {
  await page.waitForFunction(
    () => {
      const s = window.__observatory?.runtime.snapshot()
      return (
        s?.ready &&
        s.assets.every((asset) => asset.status === 'ready') &&
        s.bookDetail.status === 'ready' &&
        s.sceneDetail.status === 'ready' &&
        s.frame.submissions > 3
      )
    },
    undefined,
    { timeout: 60000 },
  )
  const s = await state(page)
  assert.equal(s.error, '')
  assert.deepEqual(s.errors, [])
  assert.ok(!/swiftshader|llvmpipe/i.test(s.adapter), s.adapter)
  assert.equal(s.frame.generations, 2)
}

async function arrive(page: Page) {
  await advance(page, 800)
  assert.equal((await state(page)).passage.active, false)
}

async function frames(page: Page) {
  const start = (await state(page)).frame.submissions
  await advance(page, 128)
  assert.ok((await state(page)).frame.submissions > start + 2)
}

async function makePage(earned: boolean) {
  const store = createJourneyStore({ worlds: ALMANAC_WORLDS })
  store.completeOnboarding()
  store.selectWorld('tideweave')
  if (earned) {
    store.completeWorld('glasswake')
    store.completeWorld('tideweave')
  }
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1000 },
  })
  context.setDefaultTimeout(15000)
  await context.addInitScript(
    ({ key, progress }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(progress))
    },
    { key: JOURNEY_STORAGE_KEY, progress: store.read().progress },
  )
  // Raw JavaScript avoids tsx keepNames helpers in serialized browser callbacks.
  await context.addInitScript({
    content: `(() => {
    const audit = []
    Object.defineProperty(window, '__bridgeInputAudit', { value: audit })
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'gotpointercapture',
      'lostpointercapture',
      'blur',
      'focus',
      'visibilitychange',
    ]) {
      window.addEventListener(
        type,
        (event) => {
          const pointer = event instanceof PointerEvent ? event : null
          const runtime = window.__observatory?.runtime
          const normalize = (sample) =>
            runtime
              ? Reflect.get(runtime, 'pointerTrace').call(runtime, sample)
              : null
          const beforeState = window.__observatory?.encounter
          const beforeFocus = document.activeElement?.tagName
          const normalized = pointer ? normalize(pointer) : null
          const coalesced = pointer
            ?.getCoalescedEvents?.()
            .map((sample) => ({
              x: sample.clientX,
              y: sample.clientY,
              point: normalize(sample),
            }))
          queueMicrotask(() => {
            audit.push({
              type,
              time: window.performance.now(),
              target:
                event.target instanceof Element
                  ? event.target.tagName
                  : 'window',
              focused: document.activeElement?.tagName,
              beforeFocus,
              hidden: document.hidden,
              hasFocus: document.hasFocus(),
              x: pointer?.clientX,
              y: pointer?.clientY,
              buttons: pointer?.buttons,
              normalized,
              beforeState,
              afterState: window.__observatory?.encounter,
              accepted: window.__observatory?.encounter.accepted,
              drawing: window.__observatory?.encounter.drawing,
              hint: window.__observatory?.encounter.hint,
              coalesced,
            })
            if (audit.length > 160) audit.shift()
          })
        },
        true,
      )
    }
  })()`,
  })
  const page = await context.newPage()
  activePage = page
  await page.clock.install()
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame())
      process.stdout.write(`navigation ${frame.url()}\n`)
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.detach()
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
  assert.equal(
    (await page.goto(`${base}/observatory?world=tideweave`))?.status(),
    200,
  )
  await ready(page)
  await pause(page)
  checkPlacement()
  return { context, page }
}

async function openCrossing(page: Page, earned = true) {
  await button(page, earned ? 'Play again' : 'Trace a melody').click()
  await arrive(page)
  assert.equal((await state(page)).view, 'trace')
  assert.equal(
    await page.evaluate(() => window.__observatory!.phrase.id),
    FIRST_BRIDGE_PHRASE.id,
  )
  if (await button(page, 'Stop phrase').isVisible())
    await button(page, 'Stop phrase').click()
}

async function move(page: Page, point: readonly [number, number], steps = 1) {
  const projected = await page.evaluate(
    (target) => window.__observatory!.runtime.projectTrace(target),
    point,
  )
  assert.ok(projected.visible)
  const canvas = await page.locator('canvas').boundingBox()
  assert.ok(canvas)
  await page.mouse.move(
    canvas.x + projected.x * canvas.width,
    canvas.y + projected.y * canvas.height,
    { steps },
  )
}

async function choose(page: Page, phrase: BridgePhrase) {
  await button(page, phrase.title).click()
  await frames(page)
  assert.equal(
    await page.evaluate(() => window.__observatory!.phrase.id),
    phrase.id,
  )
  assert.equal(
    await button(page, phrase.title).getAttribute('aria-pressed'),
    'true',
  )
  assert.equal((await encounter(page)).accepted, 0)
  assert.equal((await encounter(page)).drawing, false)
  const audio = await sound(page)
  assert.equal(audio.playing, false)
  assert.equal(audio.trace.active, false)
  assert.equal(audio.trace.pending, false)
  assert.equal(
    await page.evaluate(() => window.__observatory!.exerciseStage),
    'listen',
  )
}

async function trace(page: Page, phrase: BridgePhrase, through = 3) {
  await move(page, phrase.target[0])
  await page.mouse.down()
  await advance(page, 32)
  assert.ok(
    await page.evaluate(() =>
      Reflect.get(window, '__bridgeInputAudit').some(
        (event: { type: string }) => event.type === 'pointerdown',
      ),
    ),
    'Native pointer audit must be working before tracing',
  )
  assert.deepEqual(
    errors,
    [],
    'Audit instrumentation and page must be free of errors',
  )
  for (let index = 1; index <= through; index++) {
    const from = phrase.target[index - 1]
    const to = phrase.target[index]
    for (let sample = 1; sample <= 6; sample++) {
      const expected: readonly [number, number] = [
        from[0] + ((to[0] - from[0]) * sample) / 6,
        from[1] + ((to[1] - from[1]) * sample) / 6,
      ]
      const before = await encounter(page)
      await move(page, expected)
      await advance(page, 32)
      const progress = await encounter(page)
      inputSamples.push({
        phrase: phrase.id,
        segment: index,
        sample,
        expected,
        before,
        after: progress,
      })
      assert.ok(
        progress.drawing || progress.accepted === 4,
        `Pointer interrupted ${phrase.id} segment ${index}, sample ${sample}: ${JSON.stringify(progress)}`,
      )
    }
  }
  await page.mouse.up()
  await frames(page)
  assert.equal((await encounter(page)).accepted, through + 1)
}

function resources(snapshot: Awaited<ReturnType<typeof state>>) {
  return {
    generations: snapshot.frame.generations,
    bufferBytes: snapshot.frame.bufferBytes,
    livePoints: snapshot.frame.livePoints,
    bookDetail: snapshot.bookDetail,
    sceneDetail: snapshot.sceneDetail,
  }
}

async function captureLayout(
  page: Page,
  name: string,
  width: number,
  height: number,
) {
  await page.setViewportSize({ width, height })
  await frames(page)
  const layout = await page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll('[aria-label="Practice phrases"] button'),
    ).map((node) => {
      const r = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      )
      return {
        label: node.textContent?.trim(),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
        hittable: hit === node || node.contains(hit),
        background: style.backgroundColor,
        color: style.color,
        borderStyle: style.borderStyle,
        fontFamily: style.fontFamily,
      }
    })
    const canvas = document.querySelector('canvas')!.getBoundingClientRect()
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      controls,
      bottom: {
        y: document
          .querySelector('.observatory-bottom')!
          .getBoundingClientRect().y,
      },
      anchors: window
        .__observatory!.runtime.snapshot()
        .traceAnchors.map((point) => ({
          visible: point.visible,
          x: canvas.left + point.x * canvas.width,
          y: canvas.top + point.y * canvas.height,
        })),
    }
  })
  assert.equal(layout.overflow, false)
  assert.equal(layout.controls.length, 3)
  for (const control of layout.controls) {
    assert.ok(
      control.hittable && control.width >= 44 && control.height >= 32,
      JSON.stringify(control),
    )
    assert.ok(
      control.x >= 0 &&
        control.right <= width + 1 &&
        control.y >= 0 &&
        control.bottom <= height + 1,
      JSON.stringify(control),
    )
    assert.notEqual(control.background, 'rgba(0, 0, 0, 0)')
    assert.equal(control.borderStyle, 'solid')
  }
  assert.ok(
    layout.anchors.every(
      (point) =>
        point.visible &&
        point.x > 0 &&
        point.x < width &&
        point.y < layout.bottom.y - 12,
    ),
    JSON.stringify(layout),
  )
  await page.clock.resume()
  try {
    await page.screenshot({
      path: path.join(out!, `${name}.png`),
      timeout: 20000,
    })
  } finally {
    await pause(page)
  }
  captures.push({ name, width, height, layout })
}

async function initialGate(context: BrowserContext, page: Page) {
  step('first-encounter-gate')
  await openCrossing(page, false)
  assert.equal(await group(page).count(), 0)
  await button(page, 'Trace without sound').click()
  await trace(page, FIRST_BRIDGE_PHRASE)
  await group(page).waitFor({ state: 'visible' })
  assert.equal(
    (await saved(page)).worlds.tideweave.completion.motif.id,
    ALMANAC_WORLDS.find((world) => world.id === 'tideweave')!.motif!.id,
  )
  report.firstCompletion = {
    practiceUnavailableBeforeEarned: true,
    realPointerEarnedPage: true,
  }
  await context.close()
}

async function practice(context: BrowserContext, page: Page) {
  step('practice-open')
  const original = (await saved(page)).worlds
  await openCrossing(page)
  const initialResources = resources(await state(page))
  const { bufferBytes: initialBufferBytes, ...stable } = initialResources
  const phrases: unknown[] = []
  for (const phrase of BRIDGE_PHRASES) {
    step(`phrase-${phrase.id}`)
    await choose(page, phrase)
    await button(page, 'Replay phrase').click()
    await until(
      page,
      () => sound(page),
      (audio) => audio.playing && audio.motifId === phrase.motif.id,
      'Selected phrase must play',
    )
    await until(
      page,
      () => page.evaluate(() => window.__observatory!.exerciseStage),
      (stage) => stage === 'answer',
      'Teaching must finish before answering',
    )
    await move(page, phrase.target[2])
    await page.mouse.down()
    await page.mouse.up()
    assert.equal((await encounter(page)).accepted, 0)
    await move(page, phrase.target[0])
    await page.mouse.down()
    await until(
      page,
      () => sound(page),
      (audio) => audio.trace.active,
      'Trace instrument must sound',
    )
    const audio = await sound(page)
    assert.ok(
      Math.abs(audio.trace.midi! - phrase.motif.notes[0].midi) < 0.1,
      JSON.stringify(audio),
    )
    await page.mouse.up()
    // Rejoin the first earned note and complete through actual pointer movement.
    await trace(page, phrase)
    assert.equal(
      await page.evaluate(() => window.__observatory!.exerciseStage),
      'complete',
    )
    assert.equal((await state(page)).visual.bridgeProgress, 5)
    assert.deepEqual((await saved(page)).worlds, original)
    const { bufferBytes, ...retained } = resources(await state(page))
    assert.deepEqual(retained, stable)
    assert.ok(bufferBytes >= initialBufferBytes)
    phrases.push({
      id: phrase.id,
      notes: phrase.noteNames,
      commandedFirstMidi: audio.trace.midi,
      genuinePointerCompletion: true,
      savedPagesUnchanged: true,
      bufferBytes,
    })
  }
  report.phrases = phrases
  const warmedResources = resources(await state(page))
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const phrase of BRIDGE_PHRASES) {
      await choose(page, phrase)
      assert.deepEqual(resources(await state(page)), warmedResources)
    }
  }
  report.resources = {
    initial: initialResources,
    warmed: warmedResources,
    repeatedSelectionStable: true,
    note: 'First-drawn bridge and trace instances allocate retained uniforms; phrase switches do not regenerate geometry or grow these warmed allocations.',
  }
  step('switch-during-teaching')
  await choose(page, BRIDGE_PHRASES[1])
  await button(page, 'Replay phrase').click()
  await until(
    page,
    () => sound(page),
    (audio) => audio.playing,
    'Teaching starts before interruption',
  )
  await choose(page, BRIDGE_PHRASES[2])
  await delay(500)
  await advance(page, 320)
  assert.equal((await sound(page)).playing, false)
  assert.equal((await sound(page)).trace.active, false)
  assert.equal(
    await page.evaluate(() => window.__observatory!.exerciseStage),
    'listen',
  )
  report.teachingInterruption = {
    oldPlaybackStopped: true,
    newPhraseRequiresPlay: true,
    noDelayedRestart: true,
  }
  step('partial-switch')
  await choose(page, BRIDGE_PHRASES[1])
  await button(page, 'Trace without sound').click()
  await trace(page, BRIDGE_PHRASES[1], 1)
  await choose(page, BRIDGE_PHRASES[2])
  assert.deepEqual((await saved(page)).worlds, original)
  report.partialSwitch = {
    attemptReset: true,
    soundStopped: true,
    pagesPreserved: true,
  }

  step('keyboard')
  await button(page, 'Trace without sound').click()
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Enter')
  assert.equal((await encounter(page)).accepted, 1)
  assert.equal((await encounter(page)).drawing, true)
  await page.keyboard.press('Enter')
  assert.equal((await encounter(page)).drawing, false)
  await page.keyboard.press('Enter')
  for (let index = 1; index < BRIDGE_PHRASES[2].target.length; index++) {
    const target = BRIDGE_PHRASES[2].target[index]
    const deadline = Date.now() + 10000
    while ((await encounter(page)).accepted <= index && Date.now() < deadline) {
      const cursor = await page.evaluate(() => window.__observatory!.cursor)
      const keys = [
        Math.abs(target[0] - cursor[0]) > 0.012
          ? target[0] > cursor[0]
            ? 'ArrowRight'
            : 'ArrowLeft'
          : null,
        Math.abs(target[1] - cursor[1]) > 0.012
          ? target[1] > cursor[1]
            ? 'ArrowDown'
            : 'ArrowUp'
          : null,
      ].filter((key): key is string => key !== null)
      for (const key of keys) await page.keyboard.down(key)
      await advance(page, 64)
      for (const key of keys) await page.keyboard.up(key)
    }
    assert.ok(
      (await encounter(page)).accepted > index,
      `Keyboard failed to reach Homeward note ${index + 1}`,
    )
  }
  assert.equal((await encounter(page)).accepted, 4)
  assert.equal(
    await page.evaluate(() => window.__observatory!.exerciseStage),
    'complete',
  )
  report.keyboard = {
    selectedPhraseFirstNoteAccepted: true,
    enterLifted: true,
    homewardCompletedWithRealArrowKeys: true,
  }

  step('reenter')
  await button(page, 'Return to worlds').click()
  await arrive(page)
  await openCrossing(page)
  assert.equal(
    await page.evaluate(() => window.__observatory!.phrase.id),
    FIRST_BRIDGE_PHRASE.id,
  )
  await choose(page, BRIDGE_PHRASES[2])
  step('reload')
  await page.clock.resume()
  await page.reload()
  await ready(page)
  await pause(page)
  assert.equal((await sound(page)).playing, false)
  assert.equal((await sound(page)).ambience.active, false)
  assert.deepEqual((await saved(page)).worlds, original)
  await openCrossing(page)
  assert.equal(
    await page.evaluate(() => window.__observatory!.phrase.id),
    FIRST_BRIDGE_PHRASE.id,
  )
  report.persistence = {
    canonicalOnReentry: true,
    canonicalOnReload: true,
    noReloadAutoplay: true,
    earnedWorldIdentitiesPreserved: true,
  }
  await context.close()
}

try {
  const cdp = await browser.newBrowserCDPSession()
  browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(
    (entry) => entry.type === 'browser',
  )?.id
  await cdp.detach()
  assert.ok(browserPid)
  report.browserVersion = browser.version()
  if (phase === 'all') {
    const fresh = await makePage(false)
    await initialGate(fresh.context, fresh.page)
  } else {
    report.firstCompletion = {
      testedInThisRun: false,
      note: 'Practice-only continuation; first completion is retained in the earlier first-gate receipt.',
    }
  }
  const earned = await makePage(true)
  if (phase === 'layout') {
    step('homeward-native-input-diagnostic')
    await openCrossing(earned.page)
    await choose(earned.page, BRIDGE_PHRASES[2])
    await button(earned.page, 'Trace without sound').click()
    await trace(earned.page, BRIDGE_PHRASES[2])
    report.pointerAudit = await earned.page.evaluate(() =>
      Reflect.get(window, '__bridgeInputAudit'),
    )
    await captureLayout(earned.page, 'homeward-layout', 1440, 1000)
    await earned.context.close()
  } else await practice(earned.context, earned.page)
  assert.deepEqual(errors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  process.stderr.write(`${String(error)}\n`)
  report.stack = error instanceof Error ? error.stack : undefined
  if (activePage && !activePage.isClosed()) {
    report.lastState = await state(activePage).catch(() => undefined)
    report.lastEncounter = await encounter(activePage).catch(() => undefined)
    report.pointerAudit = await activePage
      .evaluate(() => Reflect.get(window, '__bridgeInputAudit'))
      .catch(() => undefined)
    await activePage.clock.resume().catch(() => undefined)
    await activePage
      .screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 })
      .catch(() => undefined)
  }
  process.exitCode = 1
} finally {
  await browser.close()
  try {
    checkPlacement(true)
  } catch (error) {
    report.cleanupFailure = String(error)
    report.status = 'failed'
    process.exitCode = 1
  } finally {
    report.finishedAt = new Date().toISOString()
    await writeFile(
      path.join(out, 'bridge-phrases.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    )
  }
}
