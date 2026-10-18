// Real browser input and audio proof for Glasswake; controlled RAF is not headset performance proof.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { GLASS_NOTES } from '../src/observatory/glasswakeEncounter'
import { createGlasswakeGeometry, GLASSWAKE_SHARD_COUNT, writeGlasswakeInstance, } from '../src/observatory/glasswakeGeometry'
import { EMPTY_TRACE, GLASSWAKE_CENTER, projectPoint, QUIET_MUSIC, sceneCamera, } from '../src/observatory/scene'
import type { Page } from 'playwright'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
assert.ok(
  process.env.VERIFY_OUT_DIR,
  'Set VERIFY_OUT_DIR to allocated evidence storage',
)
const out = path.resolve(process.env.VERIFY_OUT_DIR)
await mkdir(out, { recursive: true })
const errors: string[] = []
const inputEvents: unknown[] = []
let activePage: Page | undefined
let browserProcessId: number | undefined
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  nativeHeadsetTested: false,
  timing:
    'Controlled browser RAF with real mouse, touch and keyboard events. Web Audio runs in real time. This is not foreground or headset performance proof.',
  audioEvidence:
    'Amplitude comes from the shared output analyser. MIDI values are commanded pitches, not independently measured frequencies. Stop checks establish transport state; zero-volume checks sample actual output while a voice remains active.',
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
      (monitor: { id: number; specialWorkspace: { name: string } }) => [
        monitor.id,
        monitor.specialWorkspace.name,
      ],
    ),
    clients: read('clients').map(
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
  ],
})

function checkPlacement() {
  const current = desktop()
  const owned = current.clients.filter(
    (client: { pid: number }) => client.pid === browserProcessId,
  )
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
  assert.deepEqual(current.special, before.special)
  report.browserPlacement = {
    hiddenAgentWorkspace: true,
    ownedProcessId: browserProcessId,
    foregroundUnchanged:
      current.active === before.active &&
      current.workspace === before.workspace,
    before: {
      active: before.active,
      workspace: before.workspace,
      special: before.special,
    },
    after: {
      active: current.active,
      workspace: current.workspace,
      special: current.special,
    },
    note: 'Only the owned browser process is checked. User changes between other foreground applications are recorded; the agent browser must remain hidden and unfocused.',
  }
}
const scene = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
const sound = (page: Page) =>
  page.evaluate(() => window.__observatory!.audio.snapshot())
const glass = (page: Page) =>
  page.evaluate(() => ({
    ...window.__glasswake!.state,
    time: window.__glasswake!.time,
    cooling: window.__glasswake!.cooling,
    burstTimes: window.__glasswake!.burstTimes,
  }))
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const instrument = (page: Page) =>
  page.getByRole('slider', { name: 'Crystal pitch instrument', exact: true })

// Node timers remain live while the browser clock is paused; no hidden-tab RAF dependency.
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
const audible = (page: Page, midi: number) =>
  poll(
    () => sound(page),
    (value) =>
      !value.error &&
      value.trace.active &&
      !value.trace.pending &&
      !value.playing &&
      !value.effect.active &&
      value.trace.midi !== null &&
      Math.abs(value.trace.midi - midi) < 0.04 &&
      value.level > 0.001,
    `Instrument must sound near MIDI ${midi}`,
  )
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
    'All audio transports must stop',
  )
const effect = (page: Page, midi: number) =>
  poll(
    () => sound(page),
    (value) =>
      !value.error &&
      value.effect.active &&
      !value.effect.pending &&
      !value.trace.active &&
      !value.playing &&
      value.effect.midi === midi &&
      value.level > 0.001,
    `Release cue must sound for MIDI ${midi}`,
  )

async function setVolume(page: Page, value: number) {
  // Exercise the actual input handler without a focus change cancelling the held note.
  await page
    .getByRole('slider', { name: 'Volume', exact: true })
    .evaluate((element, volume) => {
      const input = element as HTMLInputElement
      input.value = String(volume)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
}

async function pitchPosition(page: Page, midi: number) {
  const rect = await instrument(page).boundingBox()
  assert.ok(rect)
  // The authored pitch range is inset by 8% so both endpoint notes remain hittable.
  const y = (0.08 + ((72 - midi) / 12) * 0.84) * rect.height
  return { x: rect.x + rect.width / 2, y: rect.y + y }
}

async function pointerDown(page: Page, midi: number) {
  await instrument(page).evaluate((element) => {
    element.addEventListener(
      'pointerdown',
      (event) => {
        ;(element as HTMLElement).dataset.verifyPointerId = String(
          (event as PointerEvent).pointerId,
        )
      },
      { once: true },
    )
  })
  const point = await pitchPosition(page, midi)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  // Process pending pointer capture with a real move before testing capture loss.
  await page.mouse.move(point.x + 1, point.y)
  return Number(await instrument(page).getAttribute('data-verify-pointer-id'))
}

async function advance(page: Page, milliseconds: number) {
  // Advance real requestAnimationFrame handlers in small increments, without setting app state.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 32)
    await page.clock.runFor(Math.min(32, milliseconds - elapsed))
}

async function arm(page: Page) {
  await advance(page, 1056)
  const value = await glass(page)
  assert.equal(value.holding, true)
  assert.equal(value.armed, true, JSON.stringify(value))
  assert.equal(value.charge, 1)
  return value
}

async function capture(page: Page, name: string) {
  await advance(page, 32)
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 15000 })
}

async function noAward(page: Page, accepted = 0) {
  const value = await glass(page)
  assert.equal(value.accepted, accepted)
  assert.equal(value.holding, false)
  assert.equal(value.armed, false)
  assert.equal(value.charge, 0)
  assert.equal(value.burstTimes.length, accepted)
  await silent(page)
}

async function verify() {
  const browserSession = await browser.newBrowserCDPSession()
  const processes = await browserSession.send('SystemInfo.getProcessInfo')
  browserProcessId = processes.processInfo.find(
    (process) => process.type === 'browser',
  )?.id
  await browserSession.detach()
  assert.ok(
    browserProcessId,
    'Browser process identity is required for workspace ownership checks',
  )
  report.browserVersion = browser.version()
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: true,
    viewport: { width: 1440, height: 950 },
  })
  context.setDefaultTimeout(10000)
  const page = await context.newPage()
  await page.exposeFunction('recordGlassInput', (event: unknown) =>
    inputEvents.push(event),
  )
  await page.addInitScript(() => {
    for (const type of [
      'blur',
      'visibilitychange',
      'pointercancel',
      'lostpointercapture',
      'pointerup',
    ]) {
      window.addEventListener(
        type,
        (event) => {
          const target = event.target as HTMLElement | null
          void (
            window as unknown as {
              recordGlassInput(event: unknown): Promise<void>
            }
          ).recordGlassInput({
            type,
            target:
              target?.getAttribute?.('aria-label') ??
              target?.tagName ??
              'window',
            hidden: document.hidden,
            accepted: window.__glasswake?.state.accepted,
            holding: window.__glasswake?.state.holding,
            armed: window.__glasswake?.state.armed,
          })
        },
        true,
      )
    }
  })
  activePage = page
  // Install before application RAF is scheduled, so pausing later retains its callbacks.
  await page.clock.install()
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(message.text())
  })
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await poll(
    () =>
      page.evaluate(() =>
        Boolean(
          window.__observatory?.runtime.snapshot().ready ||
          window.__observatory?.runtime.snapshot().error,
        ),
      ),
    Boolean,
    'Observatory must initialize',
    60000,
  )
  const initial = await scene(page)
  assert.equal(initial.ready, true, initial.error)
  assert.ok(!/swiftshader|llvmpipe/i.test(initial.adapter), initial.adapter)
  await poll(
    () => scene(page),
    (value) => value.assets.every((asset) => asset.status === 'ready'),
    'Scene assets must load',
    30000,
  )
  checkPlacement()
  report.adapter = initial.adapter
  await button(page, 'Skip introduction').click()
  await button(page, 'Wake the glass').click()
  await instrument(page).waitFor()
  assert.equal((await scene(page)).view, 'glasswake')
  assert.equal((await glass(page)).accepted, 0)
  await silent(page)
  assert.ok(
    await page
      .getByText('A guided pitch instrument. No microphone or singing score.', {
        exact: true,
      })
      .isVisible(),
  )
  const entrySubmissions = (await scene(page)).frame.submissions
  await poll(
    () => scene(page),
    (value) => value.frame.submissions >= entrySubmissions + 2,
    'Glasswake must submit two actual GPU frames before clock control',
    30000,
  )
  const browserTime = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(new Date(browserTime + 2000))
  await capture(page, '01-glasswake-ready')
  report.entry = await scene(page)
  assert.equal(
    (await scene(page)).visual.glasswake.renderedShards,
    GLASSWAKE_SHARD_COUNT,
  )

  // A pitch a full octave too high must never charge or earn a release.
  await pointerDown(page, 72)
  const wrongSound = await audible(page, 72)
  await advance(page, 1216)
  assert.equal((await glass(page)).charge, 0)
  assert.equal((await glass(page)).armed, false)
  await page.mouse.up()
  await noAward(page)
  await pointerDown(page, 60)
  await advance(page, 288)
  const early = await glass(page)
  assert.ok(early.charge > 0 && early.charge < 1, JSON.stringify(early))
  await page.mouse.up()
  await noAward(page)
  report.forgivingRetry = {
    wrongPitch: wrongSound,
    earlyHold: early,
    openedNothing: true,
  }

  // Even an armed seal cannot be earned through interruption or capture loss.
  await pointerDown(page, 60)
  await arm(page)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  await noAward(page)
  const cancelledPointer = await pointerDown(page, 60)
  await arm(page)
  await instrument(page).dispatchEvent('pointercancel', {
    pointerId: cancelledPointer,
    isPrimary: true,
    bubbles: true,
  })
  await page.mouse.up()
  await noAward(page)
  const lostPointer = await pointerDown(page, 60)
  await arm(page)
  await instrument(page).evaluate((element, pointerId) => {
    element.releasePointerCapture(pointerId)
  }, lostPointer)
  const lostPoint = await pitchPosition(page, 60)
  await page.mouse.move(lostPoint.x + 2, lostPoint.y)
  await noAward(page)
  await page.mouse.up()
  await noAward(page)
  await pointerDown(page, 60)
  await arm(page)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await noAward(page)
  assert.equal((await scene(page)).active, false)
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.mouse.up()
  await advance(page, 160)
  await noAward(page)
  report.interruptions = {
    armedBlurNeverAwards: true,
    dispatchedPointerCancelNeverAwards: true,
    nativeCaptureLossNeverAwards: true,
    simulatedVisibilityNeverAwards: true,
    resumeNeedsNewGesture: true,
    nativeTabHide:
      'Not claimed here; the observatory harness reports native visibility separately.',
  }

  await pointerDown(page, 60)
  const heldSound = await audible(page, 60)
  await setVolume(page, 0)
  const zeroVolume = await poll(
    () => sound(page),
    (value) =>
      value.trace.active && value.volume === 0 && value.level < 0.00001,
    'Zero volume must silence the measured held voice',
  )
  await setVolume(page, 0.55)
  await audible(page, 60)
  await page.mouse.up()
  await noAward(page)
  await button(page, 'Mute instrument').click()
  await pointerDown(page, 60)
  await silent(page)
  await page.mouse.up()
  await button(page, 'Instrument sound').click()
  await silent(page)
  await button(page, 'Hear note').click()
  const reference = await poll(
    () => sound(page),
    (value) =>
      value.playing &&
      !value.trace.active &&
      !value.effect.active &&
      value.level > 0.001,
    'Reference note must sound by explicit action',
  )
  await pointerDown(page, 60)
  await audible(page, 60)
  await page.mouse.up()
  await noAward(page)
  report.audioControls = {
    heldSound,
    zeroVolume,
    reference,
    restoredVolumeAudible: true,
    mutePreventsInstrumentAudio: true,
    unmuteDoesNotAutoplay: true,
    holdReplacesReference: true,
  }

  const pointerReleases: unknown[] = []
  for (const [index, note] of GLASS_NOTES.entries()) {
    await pointerDown(page, note.midi)
    await audible(page, note.midi)
    const armed = await arm(page)
    assert.equal(armed.accepted, index, 'Holding alone must not open a seal')
    await capture(page, `02-seal-${index + 1}-armed`)
    await page.mouse.up()
    assert.equal((await glass(page)).accepted, index + 1)
    const releaseSound = await effect(page, note.midi)
    await advance(page, 256)
    await capture(page, `03-seal-${index + 1}-release`)
    const burst = await glass(page)
    assert.equal(burst.burstTimes.length, index + 1)
    assert.equal(burst.cooling, true)
    const shardsPerSeal = GLASSWAKE_SHARD_COUNT / GLASS_NOTES.length
    const burstShards = (await scene(page)).visual.glasswake.renderedShards
    assert.equal(burstShards, GLASSWAKE_SHARD_COUNT - index * shardsPerSeal)
    if (index < GLASS_NOTES.length - 1) {
      await pointerDown(page, GLASS_NOTES[index + 1].midi)
      assert.equal(
        (await glass(page)).holding,
        false,
        'Cooldown ignores new holds',
      )
      await page.mouse.up()
    }
    await advance(page, 1536)
    const settled = await glass(page)
    assert.equal(settled.cooling, false)
    assert.ok(settled.time - settled.burstTimes[index] > 1.4)
    const settledShards = (await scene(page)).visual.glasswake.renderedShards
    assert.equal(
      settledShards,
      GLASSWAKE_SHARD_COUNT - (index + 1) * shardsPerSeal,
    )
    await silent(page)
    pointerReleases.push({
      note: note.name,
      armed,
      burst,
      settled,
      releaseSound,
      burstShards,
      settledShards,
      rendered: (await scene(page)).visual,
    })
    if (index === 0) {
      // Returning during the next hold keeps earned seals, but never restores charge or sound.
      await pointerDown(page, GLASS_NOTES[1].midi)
      await audible(page, GLASS_NOTES[1].midi)
      await advance(page, 288)
      assert.ok((await glass(page)).charge > 0)
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await silent(page)
      await button(page, 'Wake the glass').click()
      await advance(page, 64)
      await noAward(page, 1)
      assert.equal(
        (await scene(page)).visual.glasswake.renderedShards,
        (GLASSWAKE_SHARD_COUNT * 2) / 3,
      )
      report.partialVisitRestoration = {
        earnedSealPreserved: true,
        pendingHoldCancelled: true,
        noAudioRestart: true,
        state: await glass(page),
      }
    }
  }
  assert.equal((await glass(page)).accepted, 3)
  assert.ok(
    await page
      .getByRole('heading', { name: 'First light, released', exact: true })
      .isVisible(),
  )
  await capture(page, '04-three-seals-open')
  report.pointerReleases = pointerReleases
  const earnedPage = await page.evaluate(
    () => window.__observatory!.journey.progress.worlds.glasswake.completion,
  )
  assert.equal(earnedPage?.activity.id, 'glasswake-seals')
  await button(page, 'Return to worlds').click()
  await silent(page)
  // Replay starts a fresh encounter while the completed Almanac page remains earned.
  await button(page, 'Play again').click()
  await advance(page, 64)
  await noAward(page)
  await silent(page)
  assert.equal(
    (await scene(page)).visual.glasswake.renderedShards,
    GLASSWAKE_SHARD_COUNT,
  )
  assert.ok(
    await page
      .getByRole('heading', { name: 'Wake the glass', exact: true })
      .isVisible(),
  )
  assert.deepEqual(
    await page.evaluate(
      () => window.__observatory!.journey.progress.worlds.glasswake.completion,
    ),
    earnedPage,
    'Starting another encounter must keep the earned Almanac page',
  )
  report.completedReplay = {
    freshEncounter: true,
    earnedPagePreserved: true,
    noAudioRestart: true,
  }

  // Keyboard changes the same instrument. There is no state injection or finish hook.
  await button(page, 'Rebuild seals').click()
  await noAward(page)
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await audible(page, 61)
  await advance(page, 1056)
  assert.equal((await glass(page)).charge, 0)
  await page.keyboard.press('Enter')
  await noAward(page)
  const keyboardReleases: unknown[] = []
  let currentMidi = 61
  for (const [index, note] of GLASS_NOTES.entries()) {
    const key = note.midi > currentMidi ? 'ArrowUp' : 'ArrowDown'
    const steps = Math.round(Math.abs(note.midi - currentMidi) / 0.25)
    for (let step = 0; step < steps; step++) await page.keyboard.press(key)
    currentMidi = note.midi
    assert.equal((await glass(page)).pitch, note.midi)
    await page.keyboard.press('Enter')
    await audible(page, note.midi)
    await arm(page)
    assert.equal((await glass(page)).accepted, index)
    await page.keyboard.press('Enter')
    assert.equal((await glass(page)).accepted, index + 1)
    const releaseSound = await effect(page, note.midi)
    await advance(page, 1568)
    await silent(page)
    keyboardReleases.push({
      note: note.name,
      state: await glass(page),
      releaseSound,
    })
  }
  report.keyboard = {
    completed: true,
    wrongPitchRejected: true,
    releases: keyboardReleases,
  }

  // Motion preference changes the reward, not whether the instrument can be played.
  await button(page, 'Rebuild seals').click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await advance(page, 64)
  await poll(
    () => scene(page),
    (value) => !value.motion,
    'Reduced-motion preference must stop scene motion',
  )
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await arm(page)
  await page.keyboard.press('Enter')
  await advance(page, 32)
  const reduced = await glass(page)
  assert.equal(reduced.accepted, 1)
  assert.ok(
    reduced.time - reduced.burstTimes[0] >= 1.4,
    'Reduced motion removes traveling shard animation',
  )
  assert.equal(
    (await scene(page)).visual.glasswake.renderedShards,
    (GLASSWAKE_SHARD_COUNT * 2) / 3,
  )
  report.reducedMotion = {
    state: reduced,
    rendered: (await scene(page)).visual,
    stillPlayable: true,
  }
  await button(page, 'Rebuild seals').click()
  await silent(page)

  for (const size of [
    { width: 1440, height: 950 },
    { width: 820, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    await advance(page, 64)
    const layout = await page.evaluate(() => {
      const pad = document
        .querySelector('[data-testid="glasswake-instrument"]')!
        .getBoundingClientRect()
      const bottom = document
        .querySelector('.glasswake-bottom')!
        .getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        pad: pad.toJSON(),
        bottom: bottom.toJSON(),
        buttons: Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            '.glasswake-bottom button',
          ),
        )
          .filter((element) => element.getBoundingClientRect().width > 0)
          .map((element) => ({
            text: element.textContent,
            ...element.getBoundingClientRect().toJSON(),
          })),
      }
    })
    assert.equal(layout.overflow, false)
    assert.ok(layout.pad.width >= 44 && layout.pad.height >= 100)
    assert.ok(
      layout.pad.top >= 0 &&
        layout.pad.left >= 0 &&
        layout.pad.right <= size.width + 1,
    )
    assert.ok(layout.pad.bottom < layout.bottom.top - 8, JSON.stringify(layout))
    const geometry = createGlasswakeGeometry()
    const record = new Float32Array(24)
    const camera = sceneCamera(
      {
        selectedWorld: 'glasswake',
        view: 'glasswake',
        camera: { yaw: 0, pitch: 0, distance: 1 },
        time: 0,
        music: QUIET_MUSIC,
        instructionNote: null,
        clay: false,
        trace: EMPTY_TRACE,
      },
      size.width / size.height,
    )
    let lowestShard = 0
    for (let tick = 0; tick < 28; tick++) {
      for (let shard = 0; shard < geometry.shards.length; shard++) {
        writeGlasswakeInstance(
          geometry.shards[shard],
          shard,
          {
            center: GLASSWAKE_CENTER,
            accepted: 3,
            charge: 0,
            holding: false,
            time: tick * 0.05,
            burstTimes: [0, 0, 0],
            motion: true,
          },
          record,
          0,
        )
        for (let vertex = 0; vertex < 24; vertex++) {
          const offset = (shard * 24 + vertex) * 12
          const [x, y, z] = geometry.vertices.subarray(offset, offset + 3)
          const projected = projectPoint(camera.viewProjection, [
            record[0] * x + record[4] * y + record[8] * z + record[12],
            record[1] * x + record[5] * y + record[9] * z + record[13],
            record[2] * x + record[6] * y + record[10] * z + record[14],
          ])
          assert.equal(projected.visible, true)
          lowestShard = Math.max(lowestShard, projected.y * size.height)
        }
      }
    }
    assert.ok(
      lowestShard < layout.bottom.top - 8,
      `Fracture debris ${lowestShard}px overlaps encounter controls at ${layout.bottom.top}px`,
    )
    assert.ok(
      layout.buttons.every(
        (rect) =>
          rect.left >= -1 &&
          rect.right <= size.width + 1 &&
          rect.bottom <= size.height + 1 &&
          rect.height >= 40,
      ),
      JSON.stringify(layout),
    )
    report[`layout${size.width}x${size.height}`] = { ...layout, lowestShard }
    await capture(page, `layout-${size.width}x${size.height}`)
  }

  // Chrome's touch input dispatch produces native pointer cancellation and release.
  await page.setViewportSize({ width: 390, height: 844 })
  await advance(page, 64)
  const touch = await context.newCDPSession(page)
  const touchStart = async () => {
    const point = await pitchPosition(page, 60)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...point, id: 1, radiusX: 2, radiusY: 2 }],
    })
  }
  await touchStart()
  await audible(page, 60)
  await arm(page)
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  })
  await noAward(page)
  await touchStart()
  await arm(page)
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  assert.equal((await glass(page)).accepted, 1)
  await effect(page, 60)
  await touch.detach()
  report.touch = {
    nativeArmedCancelNeverAwards: true,
    explicitReleaseOpensOne: true,
  }

  await button(page, 'Rebuild seals').click()
  await noAward(page)
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Enter')
  await audible(page, 60)
  await button(page, 'Rebuild seals').click()
  await noAward(page)
  await button(page, 'Use keyboard').click()
  await page.keyboard.press('Enter')
  await audible(page, 60)
  await button(page, 'Return to worlds').click()
  await silent(page)
  assert.equal(
    await page.evaluate(() => window.__glasswake === undefined),
    true,
  )
  assert.equal((await scene(page)).view, 'overview')
  await button(page, 'Play again').click()
  await silent(page)
  assert.equal((await glass(page)).holding, false)
  assert.equal((await glass(page)).accepted, 0)
  report.cleanup = {
    rebuildStopsAudio: true,
    leavingDisposesEncounter: true,
    reentryDoesNotAutoplay: true,
  }
  await page.clock.resume()
  checkPlacement()
  assert.deepEqual(errors, [])
  report.errors = errors
  report.status = 'passed'
}

let deadline: ReturnType<typeof setTimeout> | undefined
try {
  await Promise.race([
    verify(),
    new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        reject(
          new Error('Glasswake verification exceeded its 9 minute deadline'),
        )
      }, 540000)
    }),
  ])
} catch (error) {
  report.status = 'failed'
  report.inputEvents = inputEvents
  report.errors = errors
  report.failure = String(error)
  if (activePage && !activePage.isClosed()) {
    try {
      report.failureState = await activePage.evaluate(() => ({
        scene: window.__observatory?.runtime.snapshot(),
        audio: window.__observatory?.audio.snapshot(),
        glass: window.__glasswake?.state,
        hidden: document.hidden,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
          .matches,
        focused: document.activeElement?.getAttribute('aria-label'),
      }))
      await activePage.screenshot({
        path: path.join(out, 'failure.png'),
        timeout: 5000,
      })
    } catch (diagnosticError) {
      report.diagnosticError = String(diagnosticError)
    }
  }
  throw error
} finally {
  if (deadline) clearTimeout(deadline)
  try {
    await writeFile(
      path.join(out, 'glasswake-report.json'),
      JSON.stringify(report, null, 2),
    )
  } finally {
    await browser.close()
  }
}
console.info(JSON.stringify(report, null, 2))
