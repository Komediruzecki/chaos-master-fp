// Standalone headed hardware proof. Output must be an explicitly allocated evidence directory.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { BRIDGE_TARGET } from '../src/observatory/encounter'
import { OBSERVATORY_ASSETS } from '../src/observatory/scene'
import type { Page } from 'playwright'
import type * as ObservatoryGpuHarness from '../tests/observatoryGpuHarness'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
assert.ok(
  process.env.VERIFY_OUT_DIR,
  'Set VERIFY_OUT_DIR to allocated evidence storage',
)
const out = path.resolve(process.env.VERIFY_OUT_DIR)
await mkdir(out, { recursive: true })
const errors: string[] = []
let browserProcessId: number | undefined
let activePage: Page | undefined
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  nativeHeadsetTested: false,
}
const desktop = () => {
  const get = (name: string) =>
    JSON.parse(execFileSync('hyprctl', ['-j', name], { encoding: 'utf8' }))
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
        address: string
        class: string
        pid: number
        workspace: { name: string }
      }) => ({
        address: c.address,
        class: c.class,
        pid: c.pid,
        workspace: c.workspace.name,
      }),
    ),
  }
}
const before = desktop()
const browser = await chromium.launch({
  headless: false,
  env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
  args: [
    '--class=agent-browser',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...(process.env.VERIFY_X11 === '1' ? ['--ozone-platform=x11'] : []),
  ],
})
const checkPlacement = () => {
  const current = desktop()
  const owned = current.clients.filter(
    (c: { pid: number }) => c.pid === browserProcessId,
  )
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
  assert.deepEqual(current.special, before.special)
  report.browserPlacement = {
    hiddenAgentWorkspace: true,
    ownedProcessId: browserProcessId,
    ownedWindows: owned,
    foregroundUnchanged:
      current.active === before.active &&
      current.workspace === before.workspace,
    note: 'The owned browser must stay hidden and unfocused. User changes between other foreground applications do not fail this check.',
  }
}
const state = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
const audio = (page: Page) =>
  page.evaluate(() => window.__observatory!.audio.snapshot())
const encounter = (page: Page) =>
  page.evaluate(() => window.__observatory!.encounter)
type SoundSnapshot = Awaited<ReturnType<typeof audio>>
// Poll outside the page: keyboard verification controls page timers, while Web Audio
// keeps real time. This also avoids relying on RAF in the hidden agent workspace.
const waitAudio = async (
  page: Page,
  predicate: (sound: SoundSnapshot) => boolean,
  reason: string,
) => {
  const deadline = Date.now() + 5000
  let sound = await audio(page)
  while (!predicate(sound) && Date.now() < deadline) {
    await delay(100)
    sound = await audio(page)
  }
  assert.ok(predicate(sound), `${reason}: ${JSON.stringify(sound)}`)
  assert.equal(sound.error, null)
  return sound
}
const traceAudible = (page: Page, midi: number, tolerance = 0.025) =>
  waitAudio(
    page,
    (sound) =>
      sound.trace.active &&
      !sound.trace.pending &&
      !sound.playing &&
      sound.trace.midi !== null &&
      Math.abs(sound.trace.midi - midi) <= tolerance &&
      sound.level > 0.001,
    `Trace must produce a measured signal near commanded MIDI ${midi}`,
  )
const traceSilent = (page: Page) =>
  waitAudio(
    page,
    (sound) =>
      !sound.trace.active &&
      !sound.trace.pending &&
      sound.trace.midi === null &&
      sound.level === 0 &&
      !sound.playing,
    'Trace must stop and stay stopped',
  )
const accent = (sound: SoundSnapshot, midi: number) => {
  // The 240 ms confirmation may finish before a slow browser round trip returns.
  assert.ok(sound.trace.accentMidi === null || sound.trace.accentMidi === midi)
  return { expectedMidi: midi, observedMidi: sound.trace.accentMidi }
}
const setVolume = async (page: Page, value: number) => {
  // Dispatch the real range control's input handler without stealing focus from
  // a held trace. Clicking the range would itself correctly interrupt the trace.
  await page
    .getByRole('slider', { name: 'Volume' })
    .evaluate((element, volume) => {
      const input = element as HTMLInputElement
      input.value = String(volume)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
}
const fingerprints = (page: Page) =>
  page.evaluate(async () => {
    const hashes: Record<string, string> = {}
    for (const id of ['glasswake', 'tideweave'] as const) {
      const points = await window.__observatory!.runtime.readPoints(id, 131072)
      const bytes = new Float32Array(points!.flat())
      const digest = await window.crypto.subtle.digest('SHA-256', bytes)
      hashes[id] = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
    }
    return hashes
  })
const frames = async (page: Page, n = 2) => {
  const start = (await state(page)).frame.submissions
  await page.waitForFunction(
    (target) =>
      window.__observatory!.runtime.snapshot().frame.submissions >= target,
    start + n,
    { timeout: 30000 },
  )
}
const ready = async (page: Page) => {
  await page.waitForFunction(
    () =>
      window.__observatory?.runtime.snapshot().ready ||
      window.__observatory?.runtime.snapshot().error,
    undefined,
    { timeout: 60000 },
  )
  assert.equal((await state(page)).ready, true, (await state(page)).error)
  await page.waitForFunction(() =>
    window
      .__observatory!.runtime.snapshot()
      .assets.every((a) => a.status === 'ready' || a.status === 'error'),
  )
  await frames(page)
}
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const capture = async (page: Page, name: string) => {
  await frames(page)
  await page.screenshot({ path: path.join(out, `${name}.png`) })
}
const move = async (
  page: Page,
  point: readonly [number, number],
  steps = 1,
) => {
  const p = await page.evaluate(
    (p) => window.__observatory!.runtime.projectTrace(p),
    point,
  )
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + p.x * box.width, box.y + p.y * box.height, {
    steps,
  })
}
try {
  const browserSession = await browser.newBrowserCDPSession()
  const processes = await browserSession.send('SystemInfo.getProcessInfo')
  browserProcessId = processes.processInfo.find(
    (process) => process.type === 'browser',
  )?.id
  assert.ok(
    browserProcessId,
    'Chromium must expose its browser process for workspace ownership checks',
  )
  await browserSession.detach()
  report.browserVersion = browser.version()
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: true,
    viewport: { width: 1440, height: 950 },
  })
  const page = await context.newPage()
  activePage = page
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text())
  })
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await ready(page)
  await button(page, 'Skip introduction').click()
  checkPlacement()
  const initial = await state(page)
  assert.ok(!/swiftshader|llvmpipe/i.test(initial.adapter), initial.adapter)
  assert.ok(initial.assets.every((a) => a.status === 'ready'))
  assert.equal(initial.frame.generations, 2)
  report.initial = initial
  report.sharedDepth = await page.evaluate(async () => {
    const modulePath = '/tests/observatoryGpuHarness.ts'
    const harness = (await import(modulePath)) as typeof ObservatoryGpuHarness
    return harness.verifyObservatoryDepth()
  })
  const hashes: Record<string, string> = {}
  for (const asset of OBSERVATORY_ASSETS) {
    const delivered = await (await context.request.get(base + asset.url)).body()
    const local = await readFile(
      new URL(`../public${asset.url}`, import.meta.url),
    )
    const hash = (bytes: Uint8Array) =>
      createHash('sha256').update(bytes).digest('hex')
    assert.equal(hash(delivered), hash(local))
    hashes[asset.id] = hash(delivered)
  }
  report.runtimeAssetHashes = hashes
  const identity = await fingerprints(page)
  report.pointBufferHashes = identity
  await capture(page, '01-overview')
  await button(page, 'Hear this world').click()
  await page.waitForFunction(
    () => window.__observatory!.audio.snapshot().level > 0.001,
  )
  report.audioSignal = await audio(page)
  await frames(page, 3)
  assert.deepEqual(await fingerprints(page), identity)
  await button(page, 'Tideweave').click()
  assert.equal((await audio(page)).playing, false)
  assert.equal((await state(page)).selectedWorld, 'tideweave')
  await button(page, 'Inspect orb').click()
  await capture(page, '02-inspect-tideweave')
  await button(page, 'Widen view').click()
  await button(page, 'Pause motion').click()
  await frames(page)
  const frozen = (await state(page)).visual
  await page.waitForTimeout(500)
  await frames(page)
  assert.deepEqual((await state(page)).visual, frozen)
  assert.deepEqual(await fingerprints(page), identity)
  assert.equal((await state(page)).frame.generations, 2)
  report.retainedSamplesAndPause = true
  console.info(
    'Asset delivery, audio, retained identity and motion pause passed',
  )
  await button(page, 'Trace a melody').click()
  await page.waitForFunction(
    () => window.__observatory!.exerciseStage === 'answer',
    undefined,
    { timeout: 15000 },
  )
  await frames(page)
  assert.ok(
    await page
      .getByText('Guided tracing. No pitch or rhythm score.')
      .isVisible(),
  )
  await capture(page, '03-bridge-guided')
  // A later note cannot start; neither can a jump from the first to the last.
  await move(page, BRIDGE_TARGET[2])
  await page.mouse.down()
  await page.mouse.up()
  assert.equal((await encounter(page)).accepted, 0)
  await traceSilent(page)
  await move(page, BRIDGE_TARGET[0])
  await page.mouse.down()
  const pointerD = await traceAudible(page, 62)
  const firstAccent = accent(pointerD, 62)
  await move(page, BRIDGE_TARGET[3])
  await traceSilent(page)
  await page.mouse.up()
  assert.equal((await encounter(page)).accepted, 1)
  // A genuine continuous pointer trace earns two notes, survives a lift, and resumes.
  await move(page, BRIDGE_TARGET[0])
  await page.mouse.down()
  await traceAudible(page, 62)
  await move(page, BRIDGE_TARGET[1], 20)
  const pointerF = await traceAudible(page, 65)
  const secondAccent = accent(pointerF, 65)
  await page.mouse.up()
  await traceSilent(page)
  assert.equal((await encounter(page)).accepted, 2)
  await capture(page, '04-bridge-half')
  await move(page, BRIDGE_TARGET[1])
  await page.mouse.down()
  await traceAudible(page, 65)
  await move(page, [0.5, 0.36], 12)
  const pointerRising = await traceAudible(page, 68 + 1 / 3)
  await move(page, BRIDGE_TARGET[2], 24)
  const pointerB = await traceAudible(page, 71)
  const thirdAccent = accent(pointerB, 71)
  await move(page, [0.755, 0.24], 12)
  const pointerFalling = await traceAudible(page, 70)
  // Observe inside the input events: hidden-window mouse interpolation can take
  // longer than the whole coda after first entering the final target's radius.
  const eventProof = await page.evaluateHandle(() => {
    const proof = {
      completion: null as SoundSnapshot | null,
      released: null as SoundSnapshot | null,
      completedAt: 0,
      releasedAt: 0,
    }
    const canvas = document.querySelector('canvas')!
    // Array callbacks avoid tsx's inferred-name helper inside serialized code.
    const listeners = [
      () => {
        queueMicrotask(() => {
          if (window.__observatory!.exerciseStage === 'complete') {
            proof.completion = window.__observatory!.audio.snapshot()
            proof.completedAt = window.performance.now()
          }
        })
      },
    ]
    canvas.addEventListener('pointermove', listeners[0])
    canvas.addEventListener(
      'pointerup',
      () => {
        queueMicrotask(() => {
          proof.released = window.__observatory!.audio.snapshot()
          proof.releasedAt = window.performance.now()
          canvas.removeEventListener('pointermove', listeners[0])
        })
      },
      { once: true },
    )
    return proof
  })
  // This final step is <0.18 in trace coordinates and follows the same path.
  await move(page, BRIDGE_TARGET[3])
  await page.mouse.up()
  const releaseProof = await eventProof.jsonValue()
  await eventProof.dispose()
  const pointerEnd = releaseProof.completion
  const resolutionAfterLift = releaseProof.released
  assert.ok(pointerEnd?.trace.active, JSON.stringify(releaseProof))
  assert.ok(
    resolutionAfterLift?.trace.active &&
      resolutionAfterLift.level > 0.001 &&
      !resolutionAfterLift.playing,
    `Successful release must preserve the earned resolution: ${JSON.stringify(releaseProof)}`,
  )
  const finalAccent = accent(pointerEnd, 69)
  await traceSilent(page)
  assert.equal((await encounter(page)).accepted, 4)
  const earnedPage = await page.evaluate(
    () => window.__observatory!.journey.progress.worlds.tideweave.completion,
  )
  assert.equal(earnedPage?.activity.id, 'tideweave-trace')
  await frames(page)
  assert.equal((await state(page)).visual.bridgeProgress, 5)
  await capture(page, '05-bridge-complete')
  report.pointer = {
    skippedStartRejected: true,
    jumpRejected: true,
    retryPreservesProgress: true,
    completed: true,
  }
  report.traceAudioPointer = {
    evidence:
      'Levels are measured from the shared analyser. MIDI is the commanded oscillator pitch, not an independent frequency estimate.',
    firstNote: pointerD,
    secondNote: pointerF,
    rising: pointerRising,
    peak: pointerB,
    falling: pointerFalling,
    completion: pointerEnd,
    resolutionAfterLift,
    releaseProof,
    completionResponseSurvivesNormalLift: true,
    accents: [firstAccent, secondAccent, thirdAccent, finalAccent],
    liftStopped: true,
    invalidJumpStopped: true,
    skippedStartSilent: true,
  }
  console.info('Pointer completion and retry passed')
  // Volume is measured after the shared output gain while the trace stays held.
  await button(page, 'Start again').click()
  await traceSilent(page)
  await move(page, BRIDGE_TARGET[0])
  await page.mouse.down()
  await traceAudible(page, 62)
  await setVolume(page, 0)
  const zeroVolume = await waitAudio(
    page,
    (sound) =>
      sound.volume === 0 && sound.trace.active && sound.level < 0.00001,
    'Zero volume must silence the measured signal without ending the held trace',
  )
  await setVolume(page, 0.55)
  await traceAudible(page, 62)
  await page.mouse.up()
  await traceSilent(page)
  await button(page, 'Mute trace').click()
  await move(page, BRIDGE_TARGET[0])
  await page.mouse.down()
  await traceSilent(page)
  await page.mouse.up()
  await button(page, 'Trace sound').click()
  await traceSilent(page)
  await move(page, BRIDGE_TARGET[0])
  await page.mouse.down()
  await traceAudible(page, 62)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await traceSilent(page)
  assert.equal((await encounter(page)).drawing, false)
  await page.mouse.up()
  await move(page, BRIDGE_TARGET[0])
  await page.mouse.down()
  await traceAudible(page, 62)
  // Handler proof is explicit here; the existing native visibility probe below
  // separately reports whether this automation surface can really hide a tab.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await traceSilent(page)
  assert.equal((await encounter(page)).drawing, false)
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.mouse.up()
  await traceSilent(page)
  await move(page, BRIDGE_TARGET[1], 20)
  await traceSilent(page)
  report.traceAudioControls = {
    zeroVolume,
    restoredVolumeAudible: true,
    mutePreventsTraceAudio: true,
    unmuteNeedsNewGesture: true,
    blurHandlerStopsTrace: true,
    simulatedHiddenStopsTrace: true,
    resumeAndMovementDoNotRestartAudio: true,
  }
  // Drive the same judge with actual key events. No state injection or completion hook.
  await button(page, 'Start again').click()
  await button(page, 'Use keyboard').click()
  // A hidden compositor schedules rAF at roughly 1 Hz here. Controlled frame time
  // proves actual keyboard input without claiming foreground/GPU performance.
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  report.keyboardClock =
    'Controlled 32 ms frames; real key events and real WebGPU'
  await page.keyboard.press('Enter')
  assert.equal((await encounter(page)).accepted, 1)
  const keyboardD = await traceAudible(page, 62)
  await page.keyboard.press('Enter')
  await traceSilent(page)
  await page.keyboard.press('Enter')
  await traceAudible(page, 62)
  let previousMidi = 62
  let keyboardRose = false
  let keyboardFell = false
  const keyboardNotes: SoundSnapshot[] = []
  for (const target of BRIDGE_TARGET.slice(1)) {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const cursor = await page
        .locator('.observatory-keyboard-cursor')
        .boundingBox()
      assert.ok(cursor)
      const projected = await page.evaluate(
        (p) => window.__observatory!.runtime.projectTrace(p),
        target,
      )
      const box = (await page.locator('canvas').boundingBox())!
      const dx = projected.x * box.width + box.x - (cursor.x + cursor.width / 2)
      const dy =
        projected.y * box.height + box.y - (cursor.y + cursor.height / 2)
      if (Math.hypot(dx, dy) < 7 || (await encounter(page)).accepted === 4)
        break
      const keys = [
        Math.abs(dx) > 4 ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : '',
        Math.abs(dy) > 4 ? (dy > 0 ? 'ArrowDown' : 'ArrowUp') : '',
      ].filter(Boolean)
      for (const key of keys) await page.keyboard.down(key)
      await page.clock.runFor(32)
      for (const key of keys) await page.keyboard.up(key)
      const tracedSound = await audio(page)
      if (tracedSound.trace.midi !== null && (await encounter(page)).drawing) {
        keyboardRose ||= tracedSound.trace.midi > previousMidi + 0.005
        keyboardFell ||= tracedSound.trace.midi < previousMidi - 0.005
        previousMidi = tracedSound.trace.midi
      }
      assert.equal(
        (await encounter(page)).drawing ||
          (await encounter(page)).accepted === 4,
        true,
        JSON.stringify(await encounter(page)),
      )
    }
    if ((await encounter(page)).accepted < 4)
      keyboardNotes.push(
        await traceAudible(page, target === BRIDGE_TARGET[1] ? 65 : 71, 0.3),
      )
  }
  assert.equal(
    (await encounter(page)).accepted,
    4,
    'Actual keyboard trace must complete',
  )
  assert.equal(
    keyboardRose,
    true,
    'Held upward arrows must raise the trace pitch',
  )
  assert.equal(
    keyboardFell,
    true,
    'Held downward arrows must lower the trace pitch',
  )
  await traceSilent(page)
  await page.clock.resume()
  report.keyboard = { completed: true }
  report.traceAudioKeyboard = {
    firstNote: keyboardD,
    intermediateNotes: keyboardNotes,
    upwardAndDownwardPitch: true,
    enterLiftStopped: true,
    completionTailEnded: true,
  }
  console.info('Keyboard completion passed')
  await button(page, 'Start again').click()
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Enter')
  await traceAudible(page, 62)
  await button(page, 'Start again').click()
  await traceSilent(page)
  assert.equal((await encounter(page)).accepted, 0)
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Enter')
  await traceAudible(page, 62)
  await button(page, 'Return to worlds').click()
  await traceSilent(page)
  report.traceAudioResetAndLeave = { resetStopped: true, leaveStopped: true }
  await button(page, 'Hear this world').click()
  await page.waitForFunction(
    () => window.__observatory!.audio.snapshot().playing,
  )
  const cover = await context.newPage()
  await cover.goto('about:blank')
  await cover.bringToFront()
  // Playwright enables focus emulation by default, keeping background tabs visible.
  // Restore Chromium's native visibility while a second tab is in front.
  const visibilitySession = await context.newCDPSession(page)
  await visibilitySession.send('Emulation.setFocusEmulationEnabled', {
    enabled: false,
  })
  const nativeHidden = await page
    .waitForFunction(() => document.hidden, undefined, {
      timeout: 3000,
      // Native hidden documents stop RAF; poll using a timer.
      polling: 100,
    })
    .then(
      () => true,
      () => false,
    )
  report.nativeVisibility = {
    observedHidden: nativeHidden,
    limitation: nativeHidden
      ? null
      : 'The hidden automation surface keeps background documents visible. Native tab-hide behavior remains unverified.',
  }
  if (!nativeHidden) {
    // Explicit simulation tests our handlers without claiming native browser behavior.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  assert.equal((await audio(page)).playing, false)
  assert.equal((await audio(page)).progress, 0)
  assert.equal((await state(page)).active, false)
  if (!nativeHidden) {
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  await visibilitySession.send('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  })
  await visibilitySession.detach()
  await cover.close()
  await page.bringToFront()
  assert.equal((await state(page)).active, true)
  assert.equal((await audio(page)).playing, false)
  report.visibilityHandlers = {
    audioStopped: true,
    renderSuspended: true,
    deliberateAudioResume: true,
    method: nativeHidden ? 'native' : 'simulated visibility event',
  }
  assert.deepEqual(await fingerprints(page), identity)
  for (const size of [
    { width: 820, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    await button(page, 'Play again').click()
    assert.equal((await encounter(page)).accepted, 0)
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__observatory!.journey.progress.worlds.tideweave.completion,
      ),
      earnedPage,
      'Starting another trace must keep the earned Almanac page',
    )
    if (await button(page, 'Stop phrase').isVisible())
      await button(page, 'Stop phrase').click()
    await button(page, 'Trace without sound').click()
    await frames(page)
    const layout = await page.evaluate(() => {
      const bottom = document
        .querySelector('.observatory-bottom')!
        .getBoundingClientRect()
      const canvas = document.querySelector('canvas')!.getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        height: canvas.height,
        bottomTop: bottom.top,
        targets: window
          .__observatory!.runtime.snapshot()
          .traceAnchors.map((p) => ({
            x: canvas.left + p.x * canvas.width,
            y: canvas.top + p.y * canvas.height,
            visible: p.visible,
          })),
        buttons: Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            '.observatory-bottom button',
          ),
        ).map((b) => ({
          text: b.textContent,
          ...b.getBoundingClientRect().toJSON(),
        })),
      }
    })
    assert.equal(layout.overflow, false)
    assert.equal(layout.height, size.height)
    assert.ok(
      layout.targets.every((p) => p.visible && p.y < layout.bottomTop - 12),
      JSON.stringify(layout),
    )
    assert.ok(
      layout.buttons.every(
        (b) =>
          b.bottom <= size.height + 1 &&
          b.right <= size.width + 1 &&
          b.left >= -1,
      ),
    )
    report[`layout${size.width}x${size.height}`] = layout
    await capture(page, `layout-${size.width}x${size.height}`)
    await button(page, 'Return to worlds').click()
  }
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal((await state(page)).motion, false)
  await page.evaluate(() => {
    window.__observatory!.runtime.setClay(true)
  })
  await capture(page, '06-clay')
  await page.evaluate(() => {
    window.__observatory!.runtime.setClay(false)
  })
  report.final = await state(page)
  assert.deepEqual(errors, [])
  report.errors = errors
  // Expected failures get a separate page and report, so genuine console errors cannot hide.
  const fault = await context.newPage()
  let rejectBridge = true
  await fault.route(
    '**/models/observatory/bridge-segment.glb',
    async (route) => {
      if (rejectBridge)
        await route.fulfill({
          status: 503,
          body: 'Deliberate verification failure',
        })
      else await route.continue()
    },
  )
  await fault.goto(`${base}/observatory`)
  await ready(fault)
  assert.deepEqual(await fingerprints(fault), identity)
  report.identityStableAcrossFreshRuntime = true
  assert.equal(
    (await state(fault)).assets.find((a) => a.id === 'bridge')?.status,
    'error',
  )
  rejectBridge = false
  await button(fault, 'Retry objects').click()
  await fault.waitForFunction(() =>
    window
      .__observatory!.runtime.snapshot()
      .assets.every((a) => a.status === 'ready'),
  )
  await fault.evaluate(() => {
    window.__observatory!.runtime.loseDeviceForTest()
  })
  await fault
    .getByRole('heading', { name: 'The observatory could not open' })
    .waitFor()
  report.failureRecovery = { assetRetry: true, deviceLossActionable: true }
  await fault.close()
  checkPlacement()
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.errors = errors
  report.failure = String(error)
  if (activePage && !activePage.isClosed()) {
    try {
      report.failureState = await activePage.evaluate(() => ({
        scene: window.__observatory?.runtime.snapshot(),
        audio: window.__observatory?.audio.snapshot(),
        stage: window.__observatory?.exerciseStage,
        hidden: document.hidden,
      }))
      await activePage.screenshot({ path: path.join(out, 'failure.png') })
    } catch (diagnosticError) {
      report.diagnosticFailure = String(diagnosticError)
    }
  }
  throw error
} finally {
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  await browser.close()
}
console.info(JSON.stringify(report, null, 2))
