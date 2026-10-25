// Hardware browser input and production layouts verify Glasswake reprises without claiming headset acceptance.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { createJourneyStore, JOURNEY_STORAGE_KEY, } from '../src/journey/progress'
import { FIRST_GLASS_PHRASE, GLASS_PHRASES, } from '../src/observatory/glasswakePhrases'
import type { BrowserContext, Page } from 'playwright'
import type { GlassPhrase } from '../src/observatory/glasswakePhrases'

const out = process.env.VERIFY_OUT_DIR
assert.ok(out, 'Set VERIFY_OUT_DIR to admitted evidence storage')
await mkdir(out, { recursive: true })
const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
const mode = process.env.VERIFY_MODE ?? 'functional'
assert.ok(['functional', 'production', 'reload'].includes(mode))
const errors: string[] = []
const captures: unknown[] = []
const report: Record<string, unknown> = {
  status: 'running',
  testedAt: new Date().toISOString(),
  base,
  mode,
  errors,
  captures,
  nativeHeadsetTested: false,
  scope:
    'Headed hardware WebGPU, native pointer/keyboard controls and isolated saves. Controlled 32 ms animation frames are not a performance benchmark. Web Audio uses real time; commanded MIDI and transport state are not measured pitch accuracy or subjective listening acceptance. Production layout checks do not use development getters.',
}
let activePage: Page | undefined
let browserPid: number | undefined
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const instrument = (page: Page) =>
  page.getByRole('slider', { name: 'Crystal pitch instrument', exact: true })
const group = (page: Page) =>
  page.getByRole('group', { name: 'Glasswake practice phrases', exact: true })
const scene = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
const sound = (page: Page) =>
  page.evaluate(() => window.__observatory!.audio.snapshot())
const glass = (page: Page) =>
  page.evaluate(() => ({
    ...window.__glasswake!.state,
    phrase: window.__glasswake!.phrase.id,
    listening: window.__glasswake!.listening,
    cooling: window.__glasswake!.cooling,
    time: window.__glasswake!.time,
  }))
const saved = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    JOURNEY_STORAGE_KEY,
  )

function step(name: string) {
  report.step = name
  process.stdout.write(`${name}\n`)
}

function desktop() {
  const read = (name: string) =>
    JSON.parse(
      execFileSync('hyprctl', ['-j', name], {
        encoding: 'utf8',
        timeout: 5000,
      }),
    )
  return {
    active: read('activewindow').address,
    workspace: read('activeworkspace').id,
    special: read('monitors').map(
      (entry: { specialWorkspace: { name: string } }) =>
        entry.specialWorkspace.name,
    ),
    clients: read('clients') as {
      address: string
      pid: number
      class: string
      workspace: { name: string }
    }[],
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

function placement(closed = false) {
  if (!before) return
  const current = desktop()
  const owned = current.clients.filter((client) => client.pid === browserPid)
  if (closed) assert.equal(owned.length, 0, 'Owned browser must close')
  else {
    assert.ok(owned.length > 0)
    assert.ok(
      owned.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace.name === 'special:agents',
      ),
    )
    assert.ok(owned.every((client) => client.address !== current.active))
  }
  assert.ok(
    !current.special.includes('special:agents'),
    'Agent workspace must remain hidden',
  )
  report[closed ? 'cleanup' : 'placement'] = {
    hiddenAgentWorkspace: true,
    ownedWindowsClosed: closed,
    foregroundUnchanged:
      current.active === before.active &&
      current.workspace === before.workspace,
    note: 'Unrelated user foreground changes are recorded, not rejected. No workspace was switched or exposed.',
  }
}

async function advance(page: Page, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 32)
    await page.clock.runFor(Math.min(32, milliseconds - elapsed))
}

async function pause(page: Page) {
  const now = await page.evaluate(() => Date.now())
  // Navigation can briefly occupy the hardware renderer between the two CDP calls.
  await page.clock.pauseAt(new Date(now + 1000))
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
}

async function until<T>(
  page: Page,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  reason: string,
  milliseconds = 12000,
) {
  const deadline = Date.now() + milliseconds
  let value = await read()
  while (!accept(value) && Date.now() < deadline) {
    await advance(page, 64)
    await delay(60)
    value = await read()
  }
  assert.ok(accept(value), `${reason}: ${JSON.stringify(value)}`)
  return value
}

async function bounded<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} exceeded 15 seconds`))
        }, 15000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function makePage(earned: boolean) {
  const store = createJourneyStore({ worlds: ALMANAC_WORLDS })
  store.completeOnboarding()
  store.selectWorld('glasswake')
  if (earned) {
    store.completeWorld('glasswake')
    store.completeWorld('tideweave')
  }
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    hasTouch: true,
    viewport: { width: 1440, height: 950 },
  })
  context.setDefaultTimeout(12000)
  await context.addInitScript(
    ({ key, progress }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(progress))
    },
    { key: JOURNEY_STORAGE_KEY, progress: store.read().progress },
  )
  // Raw JavaScript avoids tsx function-name helpers inside serialized callbacks.
  await context.addInitScript({
    content: `(() => {
    const events = [];
    Object.defineProperty(window, '__glassInputAudit', {value: events});
    for (const type of ['blur','focus','visibilitychange','pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture']) {
      window.addEventListener(type, event => {
        const initial = window.__glasswake?.state;
        queueMicrotask(() => {
          events.push({type, target: event.target?.tagName || 'window', hidden: document.hidden, focused: document.activeElement?.tagName, before: initial, after: window.__glasswake?.state});
          if (events.length > 160) events.shift();
        });
      }, true);
    }
  })()`,
  })
  const page = await context.newPage()
  activePage = page
  if (mode !== 'reload') await page.clock.install()
  page.on('crash', () => errors.push('Browser page crashed'))
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
  assert.equal(
    (await page.goto(`${base}/observatory?world=glasswake`))?.status(),
    200,
  )
  await button(page, earned ? 'Play again' : 'Wake the glass').waitFor()
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>(
        '[aria-label="Enable ambience"]',
      )?.disabled,
  )
  if (mode !== 'production') {
    await ready(page)
    const initial = await scene(page)
    assert.equal(initial.error, '')
    assert.deepEqual(initial.errors, [])
    assert.ok(!/swiftshader|llvmpipe/i.test(initial.adapter), initial.adapter)
    report.adapter = initial.adapter
  } else {
    assert.equal(
      await page.evaluate(() => typeof window.__observatory),
      'undefined',
    )
    const adapter = await page.evaluate(async () => {
      const adapter = await window.navigator.gpu.requestAdapter()
      return adapter
        ? `${adapter.info.vendor} / ${adapter.info.architecture} / ${adapter.info.description}`
        : ''
    })
    report.adapter = adapter
    assert.ok(adapter && !/swiftshader|llvmpipe/i.test(adapter))
  }
  if (mode !== 'reload') await pause(page)
  placement()
  return { context, page }
}

async function open(page: Page, earned = true) {
  await button(page, earned ? 'Play again' : 'Wake the glass').click()
  await instrument(page).waitFor()
  await advance(page, 800)
  assert.equal(await instrument(page).getAttribute('aria-disabled'), 'false')
  if (mode === 'functional') {
    assert.equal((await scene(page)).view, 'glasswake')
    assert.equal((await glass(page)).phrase, FIRST_GLASS_PHRASE.id)
  }
}

async function choose(page: Page, phrase: GlassPhrase) {
  await button(page, phrase.title).click()
  await advance(page, 96)
  assert.equal(
    await button(page, phrase.title).getAttribute('aria-pressed'),
    'true',
  )
  if (mode === 'functional') {
    const g = await glass(page)
    assert.equal(g.phrase, phrase.id)
    assert.equal(g.accepted, 0)
    assert.equal(g.holding, false)
    assert.equal(g.armed, false)
    assert.equal(g.listening, false)
    assert.equal(g.pitch, phrase.notes[0].midi)
    await quiet(page)
  }
}

async function quiet(page: Page) {
  return until(
    page,
    () => sound(page),
    (s) =>
      !s.playing &&
      !s.loading &&
      !s.trace.active &&
      !s.trace.pending &&
      !s.effect.active &&
      !s.effect.pending,
    'Foreground audio must stop',
  )
}

async function pointerDown(page: Page, midi: number) {
  const box = await instrument(page).boundingBox()
  assert.ok(box)
  await page.mouse.move(
    box.x + box.width / 2,
    box.y + box.height * (0.08 + ((72 - midi) / 12) * 0.84),
  )
  await page.mouse.down()
}

async function arm(page: Page) {
  await advance(page, 1056)
  const g = await glass(page)
  assert.equal(g.holding, true, JSON.stringify(g))
  assert.equal(g.armed, true, JSON.stringify(g))
  assert.equal(g.charge, 1)
  return g
}

async function capture(page: Page, name: string) {
  await advance(page, 64)
  if (mode === 'production') {
    await page.clock.resume()
    try {
      await bounded(
        page.screenshot({
          path: path.join(out!, `${name}.png`),
          timeout: 15000,
        }),
        `Capture ${name}`,
      )
    } finally {
      await pause(page)
    }
    captures.push({
      name,
      method:
        'Playwright screenshot with real-time animation resumed; no held-note state',
      viewport: page.viewportSize(),
    })
    return
  }
  const beforeState = mode === 'functional' ? await glass(page) : undefined
  const cdp = await page.context().newCDPSession(page)
  try {
    const image = await bounded(
      cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      }),
      `Capture ${name}`,
    )
    await writeFile(
      path.join(out!, `${name}.png`),
      Buffer.from(image.data, 'base64'),
    )
  } finally {
    await cdp.detach()
  }
  const afterState = mode === 'functional' ? await glass(page) : undefined
  if (beforeState)
    assert.deepEqual(
      afterState,
      beforeState,
      'Paused capture must preserve actual hold state',
    )
  captures.push({
    name,
    method: 'CDP screenshot of the existing frame with paused animation clock',
    viewport: page.viewportSize(),
    captureBoundary:
      'Native window surface can crop the emulated viewport or include unused black area; use production captures for full UI framing.',
    beforeState,
    afterState,
  })
}

async function completePointer(page: Page, phrase: GlassPhrase) {
  const releases: unknown[] = []
  for (const [index, note] of phrase.notes.entries()) {
    await pointerDown(page, note.midi)
    const audio = await until(
      page,
      () => sound(page),
      (s) =>
        s.trace.active &&
        !s.trace.pending &&
        s.trace.midi !== null &&
        Math.abs(s.trace.midi - note.midi) < 0.04,
      `Held MIDI ${note.midi}`,
    )
    const held = await arm(page)
    assert.equal(held.accepted, index, 'Holding alone must not award a seal')
    await page.mouse.up()
    assert.equal((await glass(page)).accepted, index + 1)
    const effect = await until(
      page,
      () => sound(page),
      (s) => s.effect.active && s.effect.midi === note.midi,
      `Release cue for ${note.name}`,
    )
    await advance(page, 1600)
    assert.equal((await glass(page)).cooling, false)
    releases.push({
      note: note.name,
      heldMidi: audio.trace.midi,
      shatterMidi: effect.effect.midi,
      explicitReleaseAwarded: true,
    })
  }
  return releases
}

async function firstGate(context: BrowserContext, page: Page) {
  step('fresh-encounter-gate')
  await open(page, false)
  assert.equal(await group(page).count(), 0)
  const releases = await completePointer(page, FIRST_GLASS_PHRASE)
  await group(page).waitFor()
  const completion = (await saved(page)).worlds.glasswake.completion
  assert.equal(
    completion.motif.id,
    ALMANAC_WORLDS.find((world) => world.id === 'glasswake')!.motif!.id,
  )
  report.firstCompletion = {
    genuinelyEarned: true,
    practiceUnavailableBeforeEarned: true,
    releases,
    completion,
  }
  await context.close()
}

async function functional(context: BrowserContext, page: Page) {
  await open(page)
  const original = (await saved(page)).worlds
  const initial = await scene(page)
  const resources = {
    generations: initial.frame.generations,
    bufferBytes: initial.frame.bufferBytes,
    livePoints: initial.frame.livePoints,
  }
  const phrases: unknown[] = []
  for (const phrase of GLASS_PHRASES) {
    step(`pattern-${phrase.id}`)
    await choose(page, phrase)
    await button(page, 'Hear pattern').click()
    await until(
      page,
      () => sound(page),
      (s) => s.playing && s.motifId === phrase.motif.id,
      'Selected pattern must play',
    )
    assert.equal((await glass(page)).listening, true)
    assert.equal(await instrument(page).getAttribute('aria-disabled'), 'true')
    await pointerDown(page, phrase.notes[0].midi)
    await advance(page, 160)
    await page.mouse.up()
    assert.equal((await glass(page)).holding, false)
    assert.equal((await glass(page)).accepted, 0)
    await button(page, 'Stop pattern').click()
    await quiet(page)
    assert.equal((await glass(page)).listening, false)
    await button(page, 'Hear note').click()
    await until(
      page,
      () => sound(page),
      (s) =>
        s.playing &&
        s.motifId === `glasswake-reference-${phrase.notes[0].midi}`,
      'Current seal reference must play',
    )
    const wrong = phrase.notes[0].midi === 60 ? 63 : 60
    await pointerDown(page, wrong)
    await advance(page, 1056)
    assert.equal((await glass(page)).charge, 0)
    await page.mouse.up()
    assert.equal((await glass(page)).accepted, 0)
    const releases = await completePointer(page, phrase)
    assert.deepEqual((await saved(page)).worlds, original)
    const s = await scene(page)
    assert.deepEqual(
      {
        generations: s.frame.generations,
        bufferBytes: s.frame.bufferBytes,
        livePoints: s.frame.livePoints,
      },
      resources,
    )
    phrases.push({
      id: phrase.id,
      notes: phrase.notes,
      teachingBlocksHold: true,
      wrongPitchRejected: true,
      releases,
      canonicalPagesPreserved: true,
    })
  }
  report.patterns = phrases
  report.resources = { ...resources, unchangedAcrossPatterns: true }

  step('teaching-and-hold-switches')
  await choose(page, GLASS_PHRASES[1])
  await button(page, 'Hear pattern').click()
  await until(
    page,
    () => sound(page),
    (s) => s.playing,
    'Teaching starts before switching',
  )
  await choose(page, GLASS_PHRASES[2])
  await delay(400)
  await quiet(page)
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Enter')
  await arm(page)
  // Tab leaves the instrument before selecting another phrase. Blur is cancellation, never release.
  for (let count = 0; count < 20; count++) {
    await page.keyboard.press('Tab')
    if (
      await button(page, 'High glint').evaluate(
        (node) => node === document.activeElement,
      )
    )
      break
  }
  assert.equal(
    await button(page, 'High glint').evaluate(
      (node) => node === document.activeElement,
    ),
    true,
  )
  assert.equal((await glass(page)).accepted, 0)
  assert.equal((await glass(page)).armed, false)
  await page.keyboard.press('Enter')
  assert.equal((await glass(page)).phrase, GLASS_PHRASES[1].id)
  await quiet(page)
  assert.deepEqual((await saved(page)).worlds, original)
  report.interruptions = {
    teachingSwitchStopsOldPattern: true,
    armedKeyboardBlurNeverAwards: true,
    explicitPhraseSelectionResetsAttempt: true,
  }

  step('native-touch-cancellation')
  await choose(page, FIRST_GLASS_PHRASE)
  const touch = await context.newCDPSession(page)
  try {
    const box = await instrument(page).boundingBox()
    assert.ok(box)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        {
          x: box.x + box.width / 2,
          y: box.y + box.height * 0.92,
          id: 1,
          radiusX: 2,
          radiusY: 2,
        },
      ],
    })
    const armed = await arm(page)
    assert.equal(armed.accepted, 0)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    })
    const cancelled = await glass(page)
    assert.equal(cancelled.holding, false)
    assert.equal(cancelled.armed, false)
    assert.equal(cancelled.accepted, 0)
    assert.equal(cancelled.charge, 0)
    await quiet(page)
    assert.deepEqual((await saved(page)).worlds, original)
    report.touch = { nativeArmedCancelNeverAwards: true, armed, cancelled }
  } finally {
    await touch.detach()
  }

  step('keyboard-falling-light')
  await choose(page, GLASS_PHRASES[2])
  await button(page, 'Use keyboard').click()
  for (const [index, note] of GLASS_PHRASES[2].notes.entries()) {
    const current = (await glass(page)).pitch
    const key = note.midi > current ? 'ArrowUp' : 'ArrowDown'
    for (let n = 0; n < Math.round(Math.abs(note.midi - current) * 4); n++)
      await page.keyboard.press(key)
    await page.keyboard.press('Enter')
    await arm(page)
    assert.equal((await glass(page)).accepted, index)
    await page.keyboard.press('Enter')
    assert.equal((await glass(page)).accepted, index + 1)
    await advance(page, 1600)
  }
  assert.deepEqual((await saved(page)).worlds, original)
  report.keyboard = {
    completedFallingLightWithRealKeys: true,
    pagesPreserved: true,
  }

  step('resonance-captures')
  await choose(page, FIRST_GLASS_PHRASE)
  await capture(page, 'glasswake-idle')
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Enter')
  await advance(page, 384)
  const half = await glass(page)
  assert.ok(half.charge > 0.3 && half.charge < 0.75)
  await capture(page, 'glasswake-charging')
  await arm(page)
  await capture(page, 'glasswake-armed')
  await button(page, 'Rebuild seals').click()
  assert.equal((await glass(page)).accepted, 0)
  await quiet(page)

  step('reentry-and-reload')
  await choose(page, GLASS_PHRASES[2])
  await button(page, 'Return to worlds').click()
  await advance(page, 800)
  await open(page)
  await choose(page, GLASS_PHRASES[1])
  await page.clock.resume()
  await page.reload()
  await ready(page)
  report.beforeReloadPause = await scene(page)
  await pause(page)
  assert.equal((await sound(page)).playing, false)
  assert.equal((await sound(page)).ambience.active, false)
  await open(page)
  assert.deepEqual((await saved(page)).worlds, original)
  report.persistence = {
    canonicalOnReentry: true,
    canonicalOnReload: true,
    noAutoplay: true,
    pagesPreserved: true,
  }

  step('tideweave-selector-regression')
  await button(page, 'Return to worlds').click()
  await advance(page, 800)
  await page
    .getByRole('group', { name: 'Choose a world', exact: true })
    .getByRole('button', { name: 'Tideweave', exact: true })
    .click()
  await advance(page, 800)
  await button(page, 'Play again').click()
  await advance(page, 800)
  if (await button(page, 'Stop phrase').isVisible())
    await button(page, 'Stop phrase').click()
  await button(page, 'Homeward').click()
  assert.equal(
    await button(page, 'Homeward').getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(
    await page.evaluate(() => window.__observatory!.phrase.id),
    'homeward',
  )
  assert.equal((await sound(page)).playing, false)
  assert.deepEqual((await saved(page)).worlds, original)
  report.tideweave = {
    sharedSelectorWorks: true,
    doesNotAutoplay: true,
    pagesPreserved: true,
  }
  await context.close()
}

async function production(context: BrowserContext, page: Page) {
  step('production-layouts')
  const original = (await saved(page)).worlds
  await open(page)
  for (const [label, width, height] of [
    ['desktop', 1440, 950],
    ['tablet', 1024, 768],
    ['phone', 390, 844],
    ['landscape', 844, 390],
  ] as const) {
    await page.setViewportSize({ width, height })
    await advance(page, 160)
    await choose(page, GLASS_PHRASES[2])
    await button(page, 'High glint').focus()
    await page.keyboard.press('Enter')
    assert.equal(
      await button(page, 'High glint').getAttribute('aria-pressed'),
      'true',
    )
    const focus = await button(page, 'High glint').evaluate((node) => {
      const style = window.getComputedStyle(node)
      return {
        focused: document.activeElement === node,
        visible: node.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineOffset: Number.parseFloat(style.outlineOffset),
      }
    })
    assert.equal(focus.focused, true)
    assert.equal(focus.visible, true)
    assert.equal(focus.outlineStyle, 'solid')
    assert.ok(focus.outlineWidth >= 2 && focus.outlineOffset >= 2)
    await choose(page, GLASS_PHRASES[2])
    await group(page).scrollIntoViewIfNeeded()
    const layout = await page.evaluate(() => {
      const group = document.querySelector(
        '[aria-label="Glasswake practice phrases"]',
      )!
      const pad = document
        .querySelector('[data-testid="glasswake-instrument"]')!
        .getBoundingClientRect()
      const bottom = document
        .querySelector('.glasswake-bottom')!
        .getBoundingClientRect()
      const resonance = document
        .querySelector('.glasswake-resonance')!
        .getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        pad: pad.toJSON(),
        bottom: bottom.toJSON(),
        resonance: resonance.toJSON(),
        buttons: Array.from(group.querySelectorAll('button')).map((node) => {
          const r = node.getBoundingClientRect()
          const style = window.getComputedStyle(node)
          const hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          )
          return {
            text: node.textContent?.trim(),
            ...r.toJSON(),
            selected: node.getAttribute('aria-pressed'),
            background: style.backgroundColor,
            color: style.color,
            border: style.borderStyle,
            borderColor: style.borderColor,
            boxShadow: style.boxShadow,
            font: style.fontFamily,
            hittable: hit === node || node.contains(hit),
          }
        }),
        notes: Array.from(
          document.querySelectorAll('.glasswake-seal-note'),
        ).map((node) => node.textContent?.trim()),
      }
    })
    assert.equal(layout.overflow, false)
    assert.deepEqual(layout.notes, ['G4', 'E4', 'C4'])
    assert.ok(layout.pad.width >= 44 && layout.pad.height >= 80)
    assert.ok(layout.pad.bottom < layout.bottom.top - 8, JSON.stringify(layout))
    assert.ok(
      layout.resonance.bottom < layout.bottom.top - 4,
      `Resonance label and charge bar must remain above the bottom panel: ${JSON.stringify(layout)}`,
    )
    assert.equal(layout.buttons.length, 3)
    for (const control of layout.buttons) {
      assert.ok(
        control.width >= 44 && control.height >= 44 && control.hittable,
        JSON.stringify(control),
      )
      assert.equal(control.border, 'solid')
      assert.notEqual(control.background, 'rgba(0, 0, 0, 0)')
    }
    const selected = layout.buttons.find(
      (control) => control.selected === 'true',
    )!
    const idle = layout.buttons.find((control) => control.selected === 'false')!
    assert.notEqual(selected.borderColor, idle.borderColor)
    assert.notEqual(selected.boxShadow, 'none')
    await capture(page, `production-${label}`)
    captures.push({ label, layout, focus })
    await button(page, 'Hear pattern').click()
    await advance(page, 64)
    assert.equal(await instrument(page).getAttribute('aria-disabled'), 'true')
    await button(page, 'Stop pattern').click()
    await advance(page, 64)
    assert.equal(await instrument(page).getAttribute('aria-disabled'), 'false')
    assert.deepEqual((await saved(page)).worlds, original)
  }
  report.production = {
    realSelectorClicks: true,
    keyboardSelection: true,
    visibleKeyboardFocus: true,
    activeAndIdleStylesDiffer: true,
    noteLabelsMatch: true,
    teachingDisabledState: true,
    savedPagesPreserved: true,
  }
  await context.close()
}

async function reloadDiagnostic(context: BrowserContext, page: Page) {
  step('real-time-reload-diagnostic')
  const original = (await saved(page)).worlds
  await button(page, 'Play again').click()
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="glasswake-instrument"]')
        ?.getAttribute('aria-disabled') === 'false',
  )
  await button(page, 'High glint').click()
  await button(page, 'Hear pattern').click()
  await page.waitForFunction(() => window.__glasswake?.listening === true)
  report.beforeReload = {
    scene: await scene(page),
    sound: await sound(page),
    glass: await glass(page),
  }
  await page.reload()
  await ready(page)
  const after = { scene: await scene(page), sound: await sound(page) }
  assert.equal(after.sound.playing, false)
  assert.equal(after.sound.ambience.active, false)
  assert.deepEqual((await saved(page)).worlds, original)
  await button(page, 'Play again').click()
  await page.waitForFunction(
    () => window.__glasswake?.phrase.id === 'first-light',
  )
  assert.equal((await glass(page)).accepted, 0)
  report.reload = {
    realTimeOnly: true,
    noPriorScreenshots: true,
    noPriorControlledClock: true,
    canonicalOnReload: true,
    noAutoplay: true,
    after,
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
  if (mode === 'functional') {
    const fresh = await makePage(false)
    await firstGate(fresh.context, fresh.page)
    const earned = await makePage(true)
    await functional(earned.context, earned.page)
  } else if (mode === 'production') {
    const earned = await makePage(true)
    await production(earned.context, earned.page)
  } else {
    const earned = await makePage(true)
    await reloadDiagnostic(earned.context, earned.page)
  }
  assert.deepEqual(errors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  report.stack = error instanceof Error ? error.stack : undefined
  process.stderr.write(`${String(error)}\n`)
  if (activePage && !activePage.isClosed()) {
    report.lastState = await scene(activePage).catch(() => undefined)
    report.lastGlass = await glass(activePage).catch(() => undefined)
    report.inputAudit = await activePage
      .evaluate(() => Reflect.get(window, '__glassInputAudit'))
      .catch(() => undefined)
    if (mode !== 'reload')
      await capture(activePage, 'failure').catch(() => undefined)
  }
  process.exitCode = 1
} finally {
  await browser.close()
  try {
    placement(true)
  } catch (error) {
    report.cleanupFailure = String(error)
    report.status = 'failed'
    process.exitCode = 1
  }
  report.finishedAt = new Date().toISOString()
  await writeFile(
    path.join(out, 'glass-phrases.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
}
