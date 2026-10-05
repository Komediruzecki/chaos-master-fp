/** Native WebGPU canvas recording and integrated desktop/touch camera controls. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { waitForGummyControlsLayout } from './gummy-study-input-checks.mjs'

const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const output = resolve(
  process.env.GUMMY_RECORDING_OUTPUT ?? '/tmp/gummy-recording',
)
const timeoutSeconds = Number(process.env.GUMMY_RECORDING_TIMEOUT ?? 240)
assert.ok(
  Number.isFinite(timeoutSeconds) &&
    timeoutSeconds > 0 &&
    timeoutSeconds <= 300,
)
const hash = (data) => createHash('sha256').update(data).digest('hex')
const hypr = (command) =>
  JSON.parse(execFileSync('hyprctl', ['-j', command], { encoding: 'utf8' }))
const desktop = () => ({
  window: hypr('activewindow').address,
  workspace: hypr('activeworkspace').id,
  monitors: hypr('monitors').map((monitor) => ({
    id: monitor.id,
    special: monitor.specialWorkspace.name,
  })),
})
const report = {
  capturedAt: new Date().toISOString(),
  base,
  videos: [],
  cameras: [],
  touch: [],
  hosts: [],
  errors: [],
  warnings: [],
  failures: [],
}
mkdirSync(output, { recursive: true })
const before = desktop()
const clientsBefore = new Set(hypr('clients').map((client) => client.address))
let browser, timer

function inspectVideo(path, name, expectMotion = true) {
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-count_frames',
        '-show_entries',
        'stream=codec_name,width,height,nb_read_frames,duration:format=duration',
        '-of',
        'json',
        path,
      ],
      { encoding: 'utf8', timeout: 20000 },
    ),
  )
  const stream = probe.streams[0]
  assert.ok(
    stream && stream.width > 200 && stream.height > 200,
    'Downloaded clip must contain canvas-sized video',
  )
  assert.ok(
    Number(stream.nb_read_frames) >= 10,
    'Downloaded clip must have multiple decodable frames',
  )
  const width = 160,
    height = 90,
    stride = width * height * 3
  const pixels = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `fps=8,scale=${width}:${height}`,
      '-frames:v',
      '64',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { timeout: 20000, maxBuffer: stride * 65 },
  )
  const frames = Math.floor(pixels.length / stride)
  assert.ok(frames >= 6, 'The clip must decode to multiple sampled frames')
  let coloredPixels = 0,
    variance = 0,
    difference = 0
  const first = pixels.subarray(0, stride),
    last = pixels.subarray((frames - 1) * stride, frames * stride)
  let sum = 0
  for (let offset = 0; offset < stride; offset += 3) {
    const r = first[offset],
      g = first[offset + 1],
      b = first[offset + 2]
    if (Math.max(r, g, b) - Math.min(r, g, b) > 35) coloredPixels++
    sum += (r + g + b) / 3
  }
  const mean = sum / (width * height)
  for (let offset = 0; offset < stride; offset += 3) {
    const luminance =
      (first[offset] + first[offset + 1] + first[offset + 2]) / 3
    variance += (luminance - mean) ** 2
    difference +=
      Math.abs(first[offset] - last[offset]) +
      Math.abs(first[offset + 1] - last[offset + 1]) +
      Math.abs(first[offset + 2] - last[offset + 2])
  }
  variance /= width * height
  difference /= stride
  assert.ok(
    coloredPixels > 80 && variance > 40,
    'Decoded WebGPU clip must contain coloured, nonblank material',
  )
  if (expectMotion)
    assert.ok(
      difference > 0.3,
      'Recorded frames must visibly change during camera motion',
    )
  const framePath = resolve(output, `${name}-decoded.png`)
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', path, '-frames:v', '1', framePath],
    { timeout: 20000 },
  )
  return {
    path,
    bytes: statSync(path).size,
    ...stream,
    decodedFrames: frames,
    coloredPixels,
    variance,
    firstLastMeanDifference: difference,
    framePath,
  }
}

try {
  const { chromium } = createRequire(import.meta.url)('playwright')
  browser = await chromium.launch({
    headless: false,
    env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
    args: [
      '--class=agent-browser',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--ignore-gpu-blocklist',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  })
  timer = setTimeout(() => {
    report.failures.push(`Recording verification exceeded ${timeoutSeconds}s`)
    void browser.close()
  }, timeoutSeconds * 1000)
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
    if (message.type() === 'warning') report.warnings.push(message.text())
  })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const canvas = page.getByTestId('gummy-bear-canvas')
  const ready = async (experiment = 'mpm') => {
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-ready="true"]') &&
        document.querySelector('[data-testid="gummy-bear-canvas"]')?.dataset
          .experiment === expected,
      experiment,
      { timeout: 60000 },
    )
    assert.equal(await canvas.count(), 1)
    await waitForGummyControlsLayout(page)
  }
  const pause = async () => {
    if (await button('Pause').count()) await button('Pause').click()
  }
  const resume = async () => {
    if (await button('Resume').count()) await button('Resume').click()
  }
  const capture = (name) =>
    page.screenshot({ path: resolve(output, `${name}.png`) })
  const inspectHosts = async () => {
    const host = await page.evaluate(() => {
      const camera = document.querySelector(
        '[data-testid="gummy-camera-controls"]',
      )
      const recording = document.querySelector(
        'fieldset[aria-label="Canvas recording"]',
      )
      const inspect = (element) => {
        const box = element.getBoundingClientRect(),
          style = window.getComputedStyle(element)
        return {
          text: element.textContent.trim(),
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          border: style.borderTopWidth,
          radius: style.borderRadius,
          font: style.fontFamily,
          color: style.color,
          background: style.backgroundColor,
        }
      }
      return {
        width: window.innerWidth,
        contentWidth: document.documentElement.scrollWidth,
        camera: inspect(camera),
        buttons: [...camera.querySelectorAll('button')].map(inspect),
        recording: inspect(recording),
        recordingButtons: [...recording.querySelectorAll('button')].map(
          inspect,
        ),
      }
    })
    assert.equal(
      host.width,
      host.contentWidth,
      'Controls must fit without horizontal overflow',
    )
    assert.equal(host.buttons.length, 3)
    assert.ok(
      Math.max(...host.buttons.map((button) => button.y)) -
        Math.min(...host.buttons.map((button) => button.y)) <
        1,
      'Three camera controls must share one row',
    )
    for (const [owner, controls] of [
      [host.camera, host.buttons],
      [host.recording, host.recordingButtons],
    ]) {
      assert.ok(owner.x >= 0 && owner.x + owner.width <= host.width + 1)
      for (const control of controls) {
        assert.ok(
          control.height >= 44,
          'Touch controls need their 44px hit target',
        )
        assert.ok(
          control.x >= owner.x &&
            control.x + control.width <= owner.x + owner.width + 1,
          'Controls must stay inside their real host',
        )
        assert.ok(
          parseFloat(control.radius) > 0 && parseFloat(control.border) > 0,
          'Control chrome must survive production styling',
        )
      }
    }
    report.hosts.push(host)
  }
  const resetView = async () => {
    await button('Reset view').click()
    await canvas.scrollIntoViewIfNeeded()
  }
  const mouseCamera = async (mode, dx, dy, shortcut = {}) => {
    await button(mode).click()
    await canvas.scrollIntoViewIfNeeded()
    const box = await canvas.boundingBox()
    const time = await canvas.getAttribute('data-sim-time')
    const image = await canvas.screenshot()
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    if (shortcut.shift) await page.keyboard.down('Shift')
    await page.mouse.down({ button: shortcut.button ?? 'left' })
    await page.mouse.move(
      box.x + box.width * 0.5 + dx,
      box.y + box.height * 0.5 + dy,
      { steps: 12 },
    )
    await page.mouse.up({ button: shortcut.button ?? 'left' })
    if (shortcut.shift) await page.keyboard.up('Shift')
    await page.waitForTimeout(150)
    const changed = await canvas.screenshot()
    assert.notEqual(
      hash(image),
      hash(changed),
      `${mode} must visibly move the camera`,
    )
    assert.equal(
      await canvas.getAttribute('data-sim-time'),
      time,
      `${mode} must not advance paused physics`,
    )
    assert.equal(
      await canvas.getAttribute('data-grip'),
      'false',
      `${mode} must not grip the material`,
    )
    report.cameras.push({
      mode,
      shortcut,
      time,
      before: hash(image),
      after: hash(changed),
    })
  }
  const download = async (
    name,
    expectMotion = true,
    activate = () => button('Download video').click(),
  ) => {
    const pending = page.waitForEvent('download')
    await activate()
    const result = await pending
    const path = resolve(output, `${name}-${result.suggestedFilename()}`)
    await result.saveAs(path)
    assert.equal(await result.failure(), null)
    const inspected = inspectVideo(path, name, expectMotion)
    report.videos.push({ name, ...inspected })
    return inspected
  }
  await page.goto(`${base}/gummy?experiment=mpm`, {
    waitUntil: 'domcontentloaded',
  })
  await ready()
  report.placement = {
    before,
    after: desktop(),
    clients: hypr('clients')
      .filter((client) => !clientsBefore.has(client.address))
      .map((client) => ({
        class: client.class,
        workspace: client.workspace.name,
      })),
  }
  assert.deepEqual(
    report.placement.after,
    before,
    'Hidden browser must not take focus',
  )
  assert.ok(
    report.placement.clients.length &&
      report.placement.clients.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace === 'special:agents',
      ),
  )
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter()
    return {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      description: adapter.info.description,
      fallback:
        adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
    }
  })
  assert.equal(report.adapter.fallback, false)
  await page.evaluate(() => {
    window.__gummyRecordingInputs = []
    for (const type of ['pointerdown', 'pointerup', 'pointercancel'])
      document.addEventListener(
        type,
        (event) =>
          window.__gummyRecordingInputs.push({
            type,
            trusted: event.isTrusted,
            pointerType: event.pointerType,
            target: event.target.tagName,
          }),
        { passive: true },
      )
  })
  await pause()
  await resetView()
  await mouseCamera('Orbit', 100, 35)
  await mouseCamera('Pan', 75, -30)
  await mouseCamera('Grab & pull', -35, 10, { button: 'right' })
  await mouseCamera('Grab & pull', 35, 10, { shift: true })
  await resetView()
  await inspectHosts()
  await capture('desktop-controls')

  // Record the native WebGPU canvas, interact through real pointer input, and decode the downloaded bytes.
  await button('Record').click()
  await button('Stop recording').waitFor()
  await page.waitForTimeout(400)
  await mouseCamera('Orbit', 140, 30)
  await page.waitForTimeout(600)
  await mouseCamera('Pan', -55, 15)
  await page.waitForTimeout(500)
  await button('Stop recording').click()
  await button('Download video').waitFor()
  await capture('desktop-recording-ready')
  await download('first')

  await resetView()
  await button('Grab & pull').click()
  await button('Record').click()
  await button('Stop recording').waitFor()
  await canvas.scrollIntoViewIfNeeded()
  const dragBox = await canvas.boundingBox()
  const dragPoint = {
    x: dragBox.x + dragBox.width / 2,
    y: dragBox.y + dragBox.height / 2,
  }
  await page.mouse.move(dragPoint.x, dragPoint.y)
  await page.mouse.down()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
        .grip === 'true',
  )
  await canvas.press('Space')
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(dragPoint.x + step * 7, dragPoint.y - step)
    await page.waitForTimeout(60)
  }
  await page.mouse.up()
  await page.waitForTimeout(650)
  await canvas.press('Space')
  await button('Stop recording').click()
  await button('Download video').waitFor()
  await download('second-live-drag')

  await button('Record').click()
  await button('Stop recording').waitFor()
  await page.waitForTimeout(350)
  await mouseCamera('Pan', 50, 25)
  await page.waitForTimeout(700)
  await button('Continuous jelly').click()
  await ready('jelly')
  await pause()
  await button('Download video').waitFor()
  assert.equal(
    await button('Stop recording').count(),
    0,
    'A replaced canvas must finish its active recording',
  )
  await download('model-switch')
  await resetView()
  await mouseCamera('Orbit', 55, 10)
  await mouseCamera('Pan', 40, -15)
  await button('MPM + marching cubes').click()
  await ready()
  await pause()

  const cdp = await context.newCDPSession(page)
  const touch = (type, points = []) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  const tap = async (locator) => {
    const box = await locator.boundingBox()
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }
    await touch('touchStart', [point])
    await touch('touchEnd')
  }
  const swipe = async (x, start, end) => {
    await touch('touchStart', [{ x, y: start, id: 1 }])
    for (let step = 1; step <= 10; step++) {
      await touch('touchMove', [
        { x, y: start + ((end - start) * step) / 10, id: 1 },
      ])
      await page.waitForTimeout(20)
    }
    await touch('touchEnd')
    await page.waitForTimeout(100)
  }
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 2,
    })
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await waitForGummyControlsLayout(page)
      await inspectHosts()
      await resetView()
      await button('Pan').scrollIntoViewIfNeeded()
      await tap(button('Pan'))
      await page.waitForFunction(() =>
        [...document.querySelectorAll('button')].some(
          (button) =>
            button.textContent.trim() === 'Pan' &&
            button.getAttribute('aria-pressed') === 'true',
        ),
      )
      await canvas.scrollIntoViewIfNeeded()
      const box = await canvas.boundingBox()
      const origin = {
        x: box.x + box.width * 0.5,
        y: box.y + box.height * 0.5,
        id: 1,
      }
      const beforePan = await canvas.screenshot(),
        time = await canvas.getAttribute('data-sim-time')
      await touch('touchStart', [origin])
      for (let step = 1; step <= 8; step++)
        await touch('touchMove', [
          { x: origin.x + step * 5, y: origin.y - step * 2, id: 1 },
        ])
      await touch('touchEnd')
      await page.waitForTimeout(150)
      const afterPan = await canvas.screenshot()
      assert.notEqual(
        hash(beforePan),
        hash(afterPan),
        'Real touch Pan must visibly shift camera',
      )
      assert.equal(await canvas.getAttribute('data-sim-time'), time)
      assert.equal(await canvas.getAttribute('data-grip'), 'false')
      if (viewport.width === 390) {
        const beforeTwoFinger = await canvas.screenshot()
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        await touch('touchStart', [
          { x: center.x - 35, y: center.y, id: 1 },
          { x: center.x + 35, y: center.y, id: 2 },
        ])
        for (let step = 1; step <= 8; step++) {
          await touch('touchMove', [
            {
              x: center.x - 35 - step * 2 + step * 3,
              y: center.y + step * 2,
              id: 1,
            },
            {
              x: center.x + 35 + step * 2 + step * 3,
              y: center.y + step * 2,
              id: 2,
            },
          ])
        }
        await touch('touchCancel')
        await page.waitForTimeout(150)
        assert.notEqual(
          hash(beforeTwoFinger),
          hash(await canvas.screenshot()),
          'Two-finger pan and pinch must visibly change the view',
        )
        assert.equal(
          await canvas.getAttribute('data-grip'),
          'false',
          'A cancelled two-finger gesture must release every grip',
        )
        report.twoFingerPanPinch = true
        await button('Record').scrollIntoViewIfNeeded()
        await tap(button('Record'))
        await button('Stop recording').waitFor()
        await canvas.scrollIntoViewIfNeeded()
        const mobileBox = await canvas.boundingBox()
        const point = {
          x: mobileBox.x + mobileBox.width / 2,
          y: mobileBox.y + mobileBox.height / 2,
          id: 1,
        }
        await page.waitForTimeout(350)
        await touch('touchStart', [point])
        for (let step = 1; step <= 8; step++) {
          await touch('touchMove', [
            { x: point.x - step * 5, y: point.y + step * 2, id: 1 },
          ])
          await page.waitForTimeout(45)
        }
        await touch('touchEnd')
        await page.waitForTimeout(550)
        await button('Stop recording').scrollIntoViewIfNeeded()
        await tap(button('Stop recording'))
        await button('Download video').waitFor()
        await button('Download video').scrollIntoViewIfNeeded()
        await page.screenshot({
          path: resolve(output, 'phone-recording-ready.png'),
        })
        await download('phone-touch', true, () => tap(button('Download video')))
      }
      // Return to the top, then use native swipes to prove lower controls remain reachable.
      await page.evaluate(() => {
        document.querySelector('main').scrollTop = 0
        document.querySelector('aside[aria-label="Gummy controls"]').scrollTop =
          0
      })
      const target = () =>
        button('Limb pull').evaluate((element) => {
          const rect = element.getBoundingClientRect(),
            x = rect.x + rect.width / 2,
            y = rect.y + rect.height / 2,
            hit = document.elementFromPoint(x, y)
          return {
            x,
            y,
            reachable:
              rect.top >= 0 &&
              rect.bottom <= window.innerHeight &&
              !!hit &&
              (hit === element || element.contains(hit)),
            pageWidth: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
          }
        })
      const entry = {
        ...viewport,
        beforePan: hash(beforePan),
        afterPan: hash(afterPan),
        initial: await target(),
        swipes: 0,
      }
      for (
        let attempt = 0;
        attempt < 20 && !(await target()).reachable;
        attempt++
      ) {
        const origin = await page.evaluate(() => {
          const aside = document.querySelector(
              'aside[aria-label="Gummy controls"]',
            ),
            rect = aside.getBoundingClientRect()
          for (
            let y = window.innerHeight * 0.82;
            y >= window.innerHeight * 0.5;
            y -= 18
          )
            for (const fraction of [0.5, 0.25, 0.75]) {
              const x = rect.x + rect.width * fraction,
                hit = document.elementFromPoint(x, y),
                end = Math.max(16, rect.top + 8, y - window.innerHeight * 0.48)
              if (
                hit &&
                aside.contains(hit) &&
                !hit.closest('button,input,select,textarea,a') &&
                y - end >= 96
              )
                return { x, start: y, end }
            }
          return {
            x: 7,
            start: window.innerHeight * 0.8,
            end: window.innerHeight * 0.25,
          }
        })
        await swipe(origin.x, origin.start, origin.end)
        entry.swipes++
      }
      entry.final = await target()
      assert.equal(
        entry.final.reachable,
        true,
        'Native touch swipes must reveal the lower model controls',
      )
      assert.equal(
        entry.final.pageWidth,
        entry.final.viewport,
        'Responsive controls must not overflow horizontally',
      )
      await page.screenshot({
        path: resolve(output, `controls-${viewport.width}.png`),
      })
      report.touch.push(entry)
    }
  } finally {
    await cdp
      .send('Emulation.setTouchEmulationEnabled', { enabled: false })
      .catch(() => {})
    await cdp.detach()
  }
  report.inputs = await page.evaluate(() => window.__gummyRecordingInputs)
  assert.ok(
    report.inputs.some(
      (event) =>
        event.trusted &&
        event.pointerType === 'mouse' &&
        event.target === 'CANVAS',
    ),
  )
  assert.ok(
    report.inputs.some(
      (event) =>
        event.trusted &&
        event.pointerType === 'touch' &&
        event.target === 'CANVAS',
    ),
  )
  assert.deepEqual(report.errors, [], 'No page or GPU errors allowed')
  assert.deepEqual(report.warnings, [], 'No page or GPU warnings allowed')
  report.passed = true
  await resume()
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  clearTimeout(timer)
  await browser?.close()
  report.finalDesktop = desktop()
  const path = resolve(output, 'gummy-recording-verification.json')
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  console.info(`Recording report: ${path}`)
}
