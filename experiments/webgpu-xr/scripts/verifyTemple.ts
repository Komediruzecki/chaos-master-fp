// Headed hardware-WebGPU proof for the optional two-world ending; never headset or frame-rate acceptance.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { JOURNEY_STORAGE_KEY, parseJourneyProgress, } from '../src/journey/progress'
import { PASSAGE_DURATION_MS } from '../src/observatory/passage'
import type { BrowserContext, Locator, Page } from 'playwright'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
assert.ok(
  process.env.VERIFY_OUT_DIR,
  'Set VERIFY_OUT_DIR to admitted evidence storage',
)
assert.ok(
  process.env.VERIFY_EARNED_SAVE,
  'Set VERIFY_EARNED_SAVE to a genuinely earned journey receipt',
)
const out = path.resolve(process.env.VERIFY_OUT_DIR)
await mkdir(out, { recursive: true })
const fixture = parseJourneyProgress(
  await readFile(process.env.VERIFY_EARNED_SAVE, 'utf8'),
)
assert.equal(
  fixture.kind,
  'valid',
  'Earned fixture must use the current save contract',
)
const earned = fixture.progress
assert.ok(
  earned.worlds.glasswake.completion && earned.worlds.tideweave.completion,
)
const errors: string[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  nativeHeadsetTested: false,
  fixture: process.env.VERIFY_EARNED_SAVE,
  eligibilityEvidence:
    'Saved pages restored from an earlier genuine keyboard-gameplay receipt. This run does not re-earn the pages.',
  timing:
    'Hardware WebGPU with controlled 32 ms requestAnimationFrame steps to avoid hidden-workspace throttling. The clock resumes only while capturing stills, then pauses again. Web Audio runs in real time. No frame-rate claim.',
  audioEvidence:
    'Actual shared AudioContext output is measured and optionally recorded by a test-only parallel tap. No microphone, generated replacement track, or listening-quality claim.',
  stopTiming:
    'Stop timing includes Playwright locator/actionability waits on the hidden workspace and subsequent observation. It is not audio-engine latency.',
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

function placement(windowsExpected = true) {
  const current = desktop()
  const owned = current.clients.filter(
    (client: { pid: number }) => client.pid === browserProcessId,
  )
  assert.ok(
    current.special.every(
      ([id, name]: [number, string]) =>
        name !== 'special:agents' ||
        before.special.some(
          ([beforeId, beforeName]: [number, string]) =>
            id === beforeId && beforeName === 'special:agents',
        ),
    ),
    'The owned agent workspace must never be revealed',
  )
  if (!windowsExpected) {
    assert.equal(owned.length, 0, 'Owned browser windows must close')
    report.cleanup = {
      ownedWindowsClosed: true,
      agentWorkspaceNeverRevealed: true,
      otherSpecialWorkspaceUnchanged:
        JSON.stringify(current.special) === JSON.stringify(before.special),
    }
    return
  }
  assert.ok(owned.length > 0, 'Owned browser must be identifiable')
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
  report.placement = {
    hiddenAgentWorkspace: true,
    ownedProcessId: browserProcessId,
    foregroundUnchanged:
      current.active === before.active &&
      current.workspace === before.workspace,
    note: 'Other user foreground-app changes are recorded, not rejected.',
  }
}

const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const scene = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
const sound = (page: Page) =>
  page.evaluate(() => window.__observatory!.audio.snapshot())

async function advance(page: Page, milliseconds = 64) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 32)
    await page.clock.runFor(Math.min(32, milliseconds - elapsed))
}

async function poll<T>(
  page: Page,
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  reason: string,
  timeout = 5000,
) {
  const deadline = Date.now() + timeout
  let value = await read()
  while (!accepts(value) && Date.now() < deadline) {
    await advance(page, 32)
    await delay(64)
    value = await read()
  }
  assert.ok(accepts(value), `${reason}: ${JSON.stringify(value)}`)
  return value
}

const silent = (page: Page) =>
  poll(
    page,
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
    'All audio owners must stop',
  )

async function open(context: BrowserContext) {
  const page = await context.newPage()
  activePage = page
  page.setDefaultTimeout(10000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.detach()
  report.focus =
    'CDP focus emulation keeps the hidden automation surface active; native tab visibility is not established.'
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(message.text())
  })
  await page.clock.install()
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  const deadline = Date.now() + 60000
  while (
    Date.now() < deadline &&
    !(await page.evaluate(() =>
      Boolean(
        window.__observatory?.runtime.snapshot().ready ||
        window.__observatory?.runtime.snapshot().error,
      ),
    ))
  )
    await delay(100)
  const state = await scene(page)
  assert.equal(state.ready, true, state.error)
  assert.ok(!/swiftshader|llvmpipe/i.test(state.adapter), state.adapter)
  report.adapter = state.adapter
  await page.clock.pauseAt(
    new Date((await page.evaluate(() => Date.now())) + 100),
  )
  await poll(
    page,
    () => scene(page),
    (value) => value.assets.every((asset) => asset.status === 'ready'),
    'All scene assets must load',
    30000,
  )
  placement()
  return page
}

async function contextWithPages(count: 0 | 1 | 2) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: true,
    viewport: { width: 1440, height: 950 },
  })
  const progress = structuredClone(earned)
  if (count < 2) progress.worlds.tideweave.completion = null
  if (count < 1) progress.worlds.glasswake.completion = null
  await context.addInitScript(
    ({ key, raw }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, raw)
    },
    { key: JOURNEY_STORAGE_KEY, raw: JSON.stringify(progress) },
  )
  return context
}

async function target(control: Locator) {
  await control.scrollIntoViewIfNeeded()
  const state = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    const hit = document.elementFromPoint(
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
      hitsSelf: hit === element || Boolean(hit && element.contains(hit)),
      color: style.color,
      background: style.backgroundColor,
      border: style.borderStyle,
      padding: style.padding,
      font: style.fontFamily,
    }
  })
  assert.ok(state.width >= 32 && state.height >= 32, JSON.stringify(state))
  assert.equal(state.inViewport, true, JSON.stringify(state))
  assert.equal(state.hitsSelf, true, JSON.stringify(state))
  return state
}

async function capture(page: Page, name: string) {
  const beforeFrame = (await scene(page)).frame.submissions
  await advance(page, 128)
  await delay(150)
  await advance(page, 32)
  assert.ok(
    (await scene(page)).frame.submissions > beforeFrame,
    'Screenshot must follow a real GPU submission',
  )
  // The same resized-surface capture boundary is exercised by verifyJourney.
  await page.clock.resume()
  try {
    await page.screenshot({
      path: path.join(out, `${name}.png`),
      timeout: 15000,
    })
  } finally {
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(new Date(now + 100))
  }
}

interface CaptureWindow extends Window {
  __templeCapture?: {
    taps: MediaStreamAudioDestinationNode[]
    contexts: AudioContext[]
    analysers: AnalyserNode[]
    recorder?: MediaRecorder
    stream?: MediaStream
    chunks: Blob[]
    stopped?: Promise<void>
  }
}

async function installAudioTap(context: BrowserContext) {
  await context.addInitScript(() => {
    const state = {
      taps: [] as MediaStreamAudioDestinationNode[],
      contexts: [] as AudioContext[],
      analysers: [] as AnalyserNode[],
      chunks: [] as Blob[],
    }
    ;(window as CaptureWindow).__templeCapture = state
    const connect: AudioNode['connect'] = Reflect.get(
      AudioNode.prototype,
      'connect',
    )
    AudioNode.prototype.connect = function (
      this: AudioNode,
      destination: AudioNode | AudioParam,
      ...ports: number[]
    ) {
      const result = Reflect.apply(connect, this, [destination, ...ports])
      if (
        destination instanceof AudioDestinationNode &&
        this.context instanceof AudioContext
      ) {
        const tap = this.context.createMediaStreamDestination()
        Reflect.apply(connect, this, [tap])
        state.taps.push(tap)
        if (!state.contexts.includes(this.context))
          state.contexts.push(this.context)
        if (this instanceof AnalyserNode) state.analysers.push(this)
      }
      return result
    } as typeof connect
  })
}

async function startRecording(page: Page) {
  return page.evaluate(() => {
    const state = (window as CaptureWindow).__templeCapture!
    const canvas = document.querySelector('canvas')!
    if (state.taps.length !== 1 || state.contexts.length !== 1)
      throw new Error(
        'The audiovisual proof requires exactly one existing audio output',
      )
    const video = canvas.captureStream(20)
    const audio = state.taps[0].stream.clone()
    const stream = new MediaStream([
      ...video.getVideoTracks(),
      ...audio.getAudioTracks(),
    ])
    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
    ].find((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType)
      throw new Error('No browser WebM audio/video recorder available')
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 128000,
    })
    state.stream = stream
    state.recorder = recorder
    state.chunks = []
    state.stopped = new Promise<void>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) state.chunks.push(event.data)
      }
      recorder.onstop = () => {
        resolve()
      }
      recorder.onerror = () => {
        reject(new Error('Browser audiovisual recording failed'))
      }
    })
    recorder.start(1000)
    return {
      mimeType,
      videoTracks: stream.getVideoTracks().length,
      audioTracks: stream.getAudioTracks().length,
      contextCount: state.contexts.length,
      width: canvas.width,
      height: canvas.height,
    }
  })
}

async function finishRecording(page: Page) {
  const result = await page.evaluate(async () => {
    const state = (window as CaptureWindow).__templeCapture!
    state.recorder!.stop()
    await state.stopped
    state.stream!.getTracks().forEach((track) => {
      track.stop()
    })
    const blob = new Blob(state.chunks, { type: state.recorder!.mimeType })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 32768)
      binary += String.fromCharCode(...bytes.subarray(index, index + 32768))
    return { bytes: bytes.length, base64: btoa(binary) }
  })
  assert.ok(
    result.bytes > 10000,
    'Recorded scene and real audio must produce a non-empty artifact',
  )
  const destination = path.join(out, 'temple-scene-with-real-audio.webm')
  await writeFile(destination, Buffer.from(result.base64, 'base64'))
  return {
    path: destination,
    bytes: result.bytes,
    scope:
      'Real canvas scene plus the existing shared audio output; page HUD is not included. Test-only parallel audio tap leaves the original playback output connected.',
  }
}

const ending = (page: Page) => page.locator('.temple-ending')
const layouts = [
  { width: 1440, height: 950 },
  { width: 1024, height: 768 },
  { width: 820, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]

async function rememberFailure() {
  if (!activePage || activePage.isClosed()) return
  await activePage
    .screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 })
    .catch(() => {})
  report.lastScene = await scene(activePage).catch(() => null)
  report.lastSound = await sound(activePage).catch(() => null)
  report.lastBody = await activePage
    .locator('body')
    .innerText()
    .catch(() => null)
}

async function openEnding(page: Page) {
  if ((await scene(page)).passage.active)
    await advance(page, PASSAGE_DURATION_MS + 32)
  await button(page, 'Open temple signal').click()
  await advance(page, PASSAGE_DURATION_MS + 32)
  assert.equal((await scene(page)).passage.active, false)
  assert.equal(await ending(page).getAttribute('data-phase'), 'ready')
  assert.equal((await scene(page)).view, 'temple')
  assert.equal((await scene(page)).visual.temple.active, true)
  assert.equal((await scene(page)).visual.temple.revealed, false)
  await silent(page)
}

async function startEnding(page: Page, name = 'Listen together') {
  if ((await scene(page)).passage.active)
    await advance(page, PASSAGE_DURATION_MS + 32)
  await button(page, name).click()
  return poll(
    page,
    () => sound(page),
    (value) =>
      value.playing &&
      value.motifId === 'irchiinnuss-two-worlds-v1' &&
      value.level > 0.0001,
    'Explicit listen must produce the real combined score',
  )
}

async function responsive(page: Page, state: string) {
  const samples = []
  for (const size of layouts) {
    await page.setViewportSize(size)
    await advance(page)
    const controls = []
    for (const name of [
      state === 'ready' ? 'Listen together' : 'Replay ending',
      'Return to worlds',
      'Pause motion',
    ])
      controls.push({ name, ...(await target(button(page, name))) })
    controls.push({
      name: 'Volume',
      ...(await target(
        page.getByRole('slider', { name: 'Volume', exact: true }),
      )),
    })
    const host = await ending(page).evaluate((element) => ({
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 1 ||
        element.scrollWidth > element.clientWidth + 1,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }))
    assert.equal(host.horizontalOverflow, false, JSON.stringify(host))
    await capture(page, `temple-${state}-${size.width}x${size.height}`)
    samples.push({ ...size, controls, ...host })
  }
  report[`${state}Layouts`] = samples
  await page.setViewportSize(layouts[0])
  await advance(page)
}

async function eligibility() {
  for (const count of [0, 1] as const) {
    const context = await contextWithPages(count)
    try {
      const page = await open(context)
      assert.equal(await button(page, 'Open temple signal').count(), 0)
      await page
        .getByRole('button', { name: /^Almanac, [0-2] of 2 pages earned$/ })
        .click()
      assert.equal(await button(page, 'Open temple signal').count(), 0)
      assert.equal(await ending(page).count(), 0)
      await silent(page)
      await capture(page, `locked-${count}-pages`)
      report[`locked${count}Pages`] = {
        overviewAndAlmanacHaveNoEnding: true,
        silent: true,
      }
    } catch (error) {
      await rememberFailure()
      throw error
    } finally {
      await context.close()
    }
  }
}

async function audioRecovery() {
  const context = await contextWithPages(2)
  await context.addInitScript(() => {
    const resume: AudioContext['resume'] = Reflect.get(
      AudioContext.prototype,
      'resume',
    )
    let rejectOnce = true
    AudioContext.prototype.resume = function () {
      if (rejectOnce) {
        rejectOnce = false
        return Promise.reject(new Error('Verification audio resume rejection'))
      }
      return resume.call(this)
    }
  })
  try {
    const page = await open(context)
    await openEnding(page)
    await button(page, 'Listen together').click()
    await poll(
      page,
      () => ending(page).getAttribute('data-phase'),
      (value) => value === 'error',
      'Audio failure must remain recoverable',
    )
    assert.ok(await page.getByRole('alert').isVisible())
    await startEnding(page, 'Replay ending')
    await button(page, 'Stop ending').click()
    await silent(page)
    report.audioRecovery = {
      injectedResumeFailureSurfaced: true,
      retryPlayedActualSound: true,
      stopSilenced: true,
    }
  } catch (error) {
    await rememberFailure()
    throw error
  } finally {
    await context.close()
  }
}

async function fullPassage(page: Page) {
  const recording = process.env.VERIFY_RECORD_AV !== '0'
  // A short earlier real play creates the existing audio destination without auto-unlock.
  const media = recording ? await startRecording(page) : null
  const started = Date.now()
  await startEnding(page, 'Replay ending')
  const samples: unknown[] = []
  const seen = new Set<string>()
  let peak = 0
  while (Date.now() - started < 45000) {
    await advance(page, 32)
    await delay(32)
    const audio = await sound(page)
    peak = Math.max(peak, audio.level)
    const phase = await ending(page).getAttribute('data-phase')
    const section = (await ending(page).getAttribute('data-section'))!
    if (!seen.has(section)) {
      seen.add(section)
      const state = await scene(page)
      samples.push({
        elapsedMilliseconds: Date.now() - started,
        phase,
        section,
        audio,
        temple: state.visual.temple,
      })
      await capture(page, `passage-${section}`)
    }
    if (phase === 'complete') break
  }
  assert.equal(
    await ending(page).getAttribute('data-phase'),
    'complete',
    'Natural audio completion must reveal the temple',
  )
  await silent(page)
  await advance(page)
  const state = await scene(page)
  assert.equal(state.visual.temple.revealed, true)
  assert.equal(state.visual.temple.progress, 1)
  assert.equal(
    state.visual.temple.renderedParts,
    state.visual.temple.totalParts,
  )
  assert.ok(state.visual.temple.renderedParts > 0)
  assert.equal(state.visual.temple.sealLit, true)
  for (const section of [
    'glasswake',
    'tideweave',
    'together',
    'threshold',
    'complete',
  ])
    assert.ok(seen.has(section), `Missing musical section ${section}`)
  assert.ok(peak > 0.001)
  const elapsed = Date.now() - started
  assert.ok(
    elapsed >= 26000 && elapsed < 45000,
    `Real-time passage took ${elapsed} ms`,
  )
  report.fullPassage = {
    elapsedMilliseconds: elapsed,
    peakMeasuredLevel: peak,
    samples,
    completedTemple: state.visual.temple,
  }
  if (recording)
    report.recording = { ...media, ...(await finishRecording(page)) }
}

async function mainJourney() {
  const context = await contextWithPages(2)
  await installAudioTap(context)
  try {
    const page = await open(context)
    await silent(page)
    const initialSave = await page.evaluate(
      (key) => localStorage.getItem(key),
      JOURNEY_STORAGE_KEY,
    )
    report.closedControls = []
    for (const size of layouts) {
      await page.setViewportSize(size)
      await advance(page)
      ;(report.closedControls as unknown[]).push({
        ...size,
        signal: await target(button(page, 'Open temple signal')),
        guide: await target(button(page, 'Guide')),
        almanac: await target(
          page.getByRole('button', { name: /^Almanac, 2 of 2 pages earned$/ }),
        ),
      })
    }
    await page.setViewportSize(layouts[0])
    await openEnding(page)
    await responsive(page, 'ready')
    await button(page, 'Pause motion').click()
    await advance(page, 160)
    const staticState = (await scene(page)).visual.temple
    assert.equal(staticState.renderedParts, staticState.totalParts)
    assert.equal(
      staticState.revealed,
      false,
      'Motion-off shows static architecture without inventing completed playback',
    )
    await capture(page, 'temple-motion-off')
    await button(page, 'Resume motion').click()
    report.motionOff = staticState

    await startEnding(page)
    const stopStarted = Date.now()
    await button(page, 'Stop ending').click()
    await silent(page)
    assert.equal(await ending(page).getAttribute('data-phase'), 'stopped')
    assert.equal((await scene(page)).visual.temple.revealed, false)
    report.stop = {
      silenceWithinMilliseconds: Date.now() - stopStarted,
      didNotReveal: true,
    }

    await startEnding(page, 'Replay ending')
    await button(page, 'Guide').click()
    await silent(page)
    assert.equal(await ending(page).count(), 0)
    await page.keyboard.press('Escape')
    await openEnding(page)
    await startEnding(page)
    await page
      .getByRole('button', { name: /^Almanac, 2 of 2 pages earned$/ })
      .click()
    await silent(page)
    assert.equal(await ending(page).count(), 0)
    await page
      .getByRole('dialog', { name: 'Your Almanac', exact: true })
      .getByRole('button', { name: 'Open temple signal', exact: true })
      .click()
    await silent(page)
    await startEnding(page)
    await page.keyboard.press('Escape')
    await silent(page)
    assert.equal(await ending(page).count(), 0)
    report.panelCancellation = {
      guide: true,
      almanac: true,
      escape: true,
      almanacEntrySilent: true,
    }

    await openEnding(page)
    await startEnding(page)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await silent(page)
    assert.equal(await ending(page).getAttribute('data-phase'), 'stopped')
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await silent(page)
    report.visibilityCancellation = {
      syntheticVisibilityEvent: true,
      stoppedAndNoResume: true,
    }

    await fullPassage(page)
    await responsive(page, 'complete')
    await page.setViewportSize({ width: 390, height: 844 })
    await advance(page)
    const box = await target(button(page, 'Replay ending'))
    const touch = await context.newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 },
      ],
    })
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await poll(
      page,
      () => sound(page),
      (value) => value.playing && value.level > 0,
      'Native emulated touch must replay sound',
    )
    await touch.detach()
    await button(page, 'Return to worlds').click()
    await silent(page)
    report.touchReplay = {
      nativeCDPTouch: true,
      actualAudio: true,
      returnStops: true,
      physicalPhoneTested: false,
    }

    await page.setViewportSize(layouts[0])
    await openEnding(page)
    await startEnding(page)
    await page.reload()
    await advance(page, 160)
    await poll(
      page,
      () =>
        page.evaluate(() =>
          Boolean(window.__observatory?.runtime.snapshot().ready),
        ),
      Boolean,
      'Reloaded scene must become ready',
      60000,
    )
    await silent(page)
    assert.equal(await ending(page).count(), 0)
    assert.equal(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        JOURNEY_STORAGE_KEY,
      ),
      initialSave,
      'Listening and replay must not alter earned-page storage',
    )
    await openEnding(page)
    await silent(page)
    assert.equal(await ending(page).getAttribute('data-phase'), 'ready')
    report.reload = {
      earnedSaveUnchanged: true,
      endingNotAutoOpened: true,
      noAutoplay: true,
      nextOpenReady: true,
    }
    placement()
  } catch (error) {
    await rememberFailure()
    throw error
  } finally {
    await context.close()
  }
}

async function panelOnly() {
  const context = await contextWithPages(2)
  await installAudioTap(context)
  try {
    const page = await open(context)
    await openEnding(page)
    await startEnding(page)
    await page
      .getByRole('button', { name: /^Almanac, 2 of 2 pages earned$/ })
      .click()
    await silent(page)
    assert.equal(
      await button(page, 'Open temple signal').count(),
      2,
      'Reproduce duplicate labels in the native modal and its inert host',
    )
    await page
      .getByRole('dialog', { name: 'Your Almanac', exact: true })
      .getByRole('button', { name: 'Open temple signal', exact: true })
      .click()
    assert.equal(
      await page
        .getByRole('dialog', { name: 'Your Almanac', exact: true })
        .count(),
      0,
    )
    await silent(page)
    await startEnding(page)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await silent(page)
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await silent(page)
    const media = await startRecording(page)
    await startEnding(page, 'Replay ending')
    await delay(1500)
    await advance(page, 160)
    report.focusedRecording = { ...media, ...(await finishRecording(page)) }
    await page.keyboard.press('Escape')
    await silent(page)
    assert.equal(await ending(page).count(), 0)
    report.panelFocus = {
      duplicateLabelReproduced: true,
      scopedModalEntryPlayed: true,
      escapeStops: true,
    }
  } catch (error) {
    await rememberFailure()
    throw error
  } finally {
    await context.close()
  }
}

async function builtUI() {
  const context = await contextWithPages(2)
  await installAudioTap(context)
  try {
    const page = await context.newPage()
    activePage = page
    page.setDefaultTimeout(10000)
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        errors.push(message.text())
    })
    await page.clock.install()
    assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
    await button(page, 'Open temple signal').waitFor({
      state: 'visible',
      timeout: 60000,
    })
    const deadline = Date.now() + 60000
    while (
      !(await button(page, 'Open temple signal').isEnabled()) &&
      Date.now() < deadline
    )
      await delay(100)
    assert.equal(await button(page, 'Open temple signal').isEnabled(), true)
    await page.clock.pauseAt(
      new Date((await page.evaluate(() => Date.now())) + 100),
    )
    placement()
    report.adapter = await page.evaluate(async () => {
      const adapter = await window.navigator.gpu.requestAdapter()
      return `${adapter?.info.vendor} / ${adapter?.info.architecture}`
    })
    assert.ok(!/swiftshader|llvmpipe/i.test(String(report.adapter)))
    assert.equal(
      await page.evaluate(() => Boolean(window.__observatory)),
      false,
      'Production proof must not depend on dev diagnostics',
    )
    const output = () =>
      page.evaluate(() => {
        const state = (window as CaptureWindow).__templeCapture!
        return {
          contexts: state.contexts.length,
          level: Math.max(
            0,
            ...state.analysers.map((analyser) => {
              const data = new Float32Array(analyser.fftSize)
              analyser.getFloatTimeDomainData(data)
              return Math.sqrt(
                data.reduce((sum, value) => sum + value * value, 0) /
                  data.length,
              )
            }),
          ),
        }
      })
    assert.deepEqual(await output(), { contexts: 0, level: 0 })
    for (const size of layouts) {
      await page.setViewportSize(size)
      await advance(page, 128)
      await target(button(page, 'Open temple signal'))
      await target(button(page, 'Guide'))
      await target(
        page.getByRole('button', { name: /^Almanac, 2 of 2 pages earned$/ }),
      )
    }
    await page.setViewportSize(layouts[0])
    await button(page, 'Open temple signal').click()
    assert.equal(await ending(page).getAttribute('data-phase'), 'ready')
    assert.deepEqual(await output(), { contexts: 0, level: 0 })
    const builtLayouts = async (phase: 'ready' | 'complete') => {
      const samples = []
      for (const size of layouts) {
        await page.setViewportSize(size)
        await advance(page, 192)
        await delay(150)
        const controls = []
        for (const name of [
          phase === 'ready' ? 'Listen together' : 'Replay ending',
          'Return to worlds',
          'Pause motion',
        ])
          controls.push({ name, ...(await target(button(page, name))) })
        controls.push({
          name: 'Volume',
          ...(await target(
            page.getByRole('slider', { name: 'Volume', exact: true }),
          )),
        })
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          ),
          false,
        )
        await page.screenshot({
          path: path.join(
            out,
            `built-${phase}-${size.width}x${size.height}.png`,
          ),
        })
        samples.push({ ...size, controls })
      }
      await page.setViewportSize(layouts[0])
      await advance(page, 128)
      report[`built${phase}Layouts`] = samples
    }
    await builtLayouts('ready')
    const started = Date.now()
    await button(page, 'Listen together').click()
    const actualSound = await poll(
      page,
      output,
      (value) => value.contexts === 1 && value.level > 0.001,
      'Production output must contain actual audio',
    )
    await poll(
      page,
      () => ending(page).getAttribute('data-phase'),
      (value) => value === 'complete',
      'Production passage must finish naturally',
      40000,
    )
    const finished = await poll(
      page,
      output,
      (value) => value.contexts === 1 && value.level < 0.00001,
      'Production ending must become silent',
    )
    assert.equal(
      (await page.locator('.temple-time span').innerText()).trim(),
      '27 / 27 s',
      'Completed passage must display a completed timer',
    )
    assert.ok(Date.now() - started >= 26000)
    await builtLayouts('complete')
    await button(page, 'Replay ending').click()
    await poll(
      page,
      output,
      (value) => value.level > 0.001,
      'Production replay must sound',
    )
    await button(page, 'Stop ending').click()
    await poll(
      page,
      output,
      (value) => value.level < 0.00001,
      'Production Stop must silence output',
    )
    await page.reload()
    await button(page, 'Open temple signal').waitFor({
      state: 'visible',
      timeout: 60000,
    })
    await advance(page, 160)
    assert.equal(await ending(page).count(), 0)
    assert.deepEqual(await output(), { contexts: 0, level: 0 })
    report.builtUI = {
      noDevDiagnostics: true,
      actualSound,
      finished,
      naturalCompletion: true,
      stopAndReplay: true,
      reloadSilent: true,
      emittedStyles: true,
    }
  } catch (error) {
    await rememberFailure()
    throw error
  } finally {
    await context.close()
  }
}

try {
  const session = await browser.newBrowserCDPSession()
  browserProcessId = (
    await session.send('SystemInfo.getProcessInfo')
  ).processInfo.find((process) => process.type === 'browser')?.id
  await session.detach()
  report.browserVersion = browser.version()
  if (process.env.VERIFY_BUILT_UI === '1') await builtUI()
  else if (process.env.VERIFY_FOCUS === 'panel') await panelOnly()
  else {
    if (process.env.VERIFY_SMOKE !== '1') {
      await eligibility()
      await audioRecovery()
    }
    await mainJourney()
  }
  assert.deepEqual(
    errors,
    [],
    'Console warnings and runtime errors must be absent',
  )
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  if (activePage && !activePage.isClosed()) {
    await activePage
      .screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 })
      .catch(() => {})
    report.lastScene = await scene(activePage).catch(() => null)
    report.lastSound = await sound(activePage).catch(() => null)
    report.lastBody = await activePage
      .locator('body')
      .innerText()
      .catch(() => null)
  }
  process.exitCode = 1
} finally {
  report.errors = errors
  await browser.close()
  try {
    placement(false)
  } catch (error) {
    report.cleanupFailure = String(error)
    report.status = 'failed'
    process.exitCode = 1
  }
  await writeFile(
    path.join(out, 'temple-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.info(
    JSON.stringify({
      status: report.status,
      failure: report.failure,
      report: path.join(out, 'temple-report.json'),
    }),
  )
}
