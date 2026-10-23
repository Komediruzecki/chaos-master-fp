/** Native GPU touch-grab regression check; emulated touch is not physical iOS Safari. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { gummyArmPoint, waitForGummyControlsLayout, } from './gummy-study-input-checks.mjs'

const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const output = resolve(process.env.GUMMY_TOUCH_OUTPUT ?? '/tmp/gummy-touch')
const viewports =
  process.env.GUMMY_TOUCH_VIEWPORT === 'tablet'
    ? [{ width: 1024, height: 768 }]
    : [
        { width: 390, height: 844 },
        { width: 1024, height: 768 },
      ]
const hash = (value) => createHash('sha256').update(value).digest('hex')
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
const before = desktop()
const clientsBefore = new Set(hypr('clients').map((client) => client.address))
const report = {
  capturedAt: new Date().toISOString(),
  base,
  cases: [],
  errors: [],
  warnings: [],
  failures: [],
  source: {},
}
for (const file of ['gummyCameraInput.ts', 'ParticleGummyBearScene.tsx'])
  report.source[file] = hash(
    readFileSync(
      new URL(`../src/components/GummyBear/${file}`, import.meta.url),
    ),
  )
mkdirSync(output, { recursive: true })
let browser, timer
try {
  const { chromium } = createRequire(import.meta.url)('playwright')
  browser = await chromium.launch({
    headless: false,
    env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
    args: [
      '--class=agent-browser',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--ignore-gpu-blocklist',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  })
  timer = setTimeout(() => {
    report.failures.push('Verification exceeded 240 seconds')
    void browser.close()
  }, 240000)
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
    if (message.type() === 'warning') report.warnings.push(message.text())
  })
  await page.goto(`${base}/gummy?experiment=mpm`, {
    waitUntil: 'domcontentloaded',
  })
  await page.getByTestId('gummy-bear-canvas').scrollIntoViewIfNeeded()
  console.info('Canvas mounted')
  await page.waitForFunction(
    () =>
      window.__gummyParticleStudy &&
      document.querySelector('[data-ready="true"]'),
    undefined,
    { timeout: 60000 },
  )
  console.info('Study ready')
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
  const canvas = page.getByTestId('gummy-bear-canvas')
  const button = (name) => page.getByRole('button', { name, exact: true })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  })
  const touch = (type, points = []) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  const tap = async (locator) => {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    await touch('touchStart', [
      { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 },
    ])
    await touch('touchEnd')
  }
  const grip = (value) =>
    page.waitForFunction(
      (expected) =>
        window.__gummyParticleStudy.info().grip === expected &&
        document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
          .grip === String(expected),
      value,
    )
  const read = () =>
    page.evaluate(async () =>
      Array.from((await window.__gummyParticleStudy.readState()).positions),
    )
  const advance = (count) =>
    page.evaluate((frames) => {
      window.__gummyParticleStudy.advanceFrames(frames)
    }, count)
  const reset = async () => {
    await page.evaluate(() => {
      window.__gummyParticleStudy.resetPaused()
    })
    if ((await button('Grab & pull').getAttribute('aria-pressed')) !== 'true')
      await tap(button('Grab & pull'))
    await canvas.scrollIntoViewIfNeeded()
    await canvas.press('Home')
  }
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await waitForGummyControlsLayout(page)
    await reset()
    const entry = { viewport, events: [] }
    report.cases.push(entry)
    await page.evaluate(() => {
      window.__gummyTouchEvents = []
      const canvas = document.querySelector('[data-testid="gummy-bear-canvas"]')
      for (const type of [
        'pointerdown',
        'gotpointercapture',
        'pointermove',
        'pointerup',
        'pointercancel',
        'lostpointercapture',
        'touchstart',
        'touchmove',
        'touchend',
        'touchcancel',
      ])
        canvas.addEventListener(
          type,
          (event) =>
            window.__gummyTouchEvents.push({
              type,
              button: event.button,
              buttons: event.buttons,
              pointerId: event.pointerId,
              pointerType: event.pointerType,
              trusted: event.isTrusted,
              defaultPrevented: event.defaultPrevented,
              x: event.clientX,
              y: event.clientY,
            }),
          { passive: true },
        )
    })
    try {
      const point = await gummyArmPoint(page)
      entry.point = point
      entry.hit = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        point,
      )
      assert.equal(entry.hit, 'CANVAS')
      await touch('touchStart', [{ ...point, id: 1 }])
      await grip(true)
      entry.gripped = true
      entry.gripStart = await page.evaluate(
        () => window.__gummyParticleStudy.info().gripCommand,
      )
      console.info(`Grip accepted at width ${viewport.width}`)
      const beforePull = await read()
      const beforeImage = await canvas.screenshot({
        path: resolve(output, `before-${viewport.width}.png`),
      })
      for (let step = 1; step <= 10; step++) {
        await touch('touchMove', [
          { x: point.x + step * 5, y: point.y - step * 2, id: 1 },
        ])
        await advance(3)
      }
      const afterPull = await read()
      entry.gripEnd = await page.evaluate(
        () => window.__gummyParticleStudy.info().gripCommand,
      )
      entry.displacement = Math.max(
        ...beforePull.map((value, index) =>
          index % 4 === 3 ? 0 : Math.abs(value - afterPull[index]),
        ),
      )
      console.info(`Pulled at width ${viewport.width}: ${entry.displacement}`)
      entry.horizontalDisplacement = Math.max(
        ...beforePull.map((value, index) =>
          index % 4 === 0 || index % 4 === 2
            ? Math.abs(value - afterPull[index])
            : 0,
        ),
      )
      assert.ok(
        entry.horizontalDisplacement > 0.03,
        'Touch pull must move particles sideways, independently of gravity',
      )
      await touch('touchEnd')
      await grip(false)
      entry.released = true
      entry.events = await page.evaluate(() => window.__gummyTouchEvents)
      const afterImage = await canvas.screenshot({
        path: resolve(output, `after-${viewport.width}.png`),
      })
      assert.notEqual(
        hash(beforeImage),
        hash(afterImage),
        'Touch pull must visibly change material',
      )
      // Exercise the ordinary RAF-driven simulation as well as deterministic GPU steps.
      await reset()
      const beforeLive = await read()
      await tap(button('Resume'))
      await canvas.scrollIntoViewIfNeeded()
      const livePoint = await gummyArmPoint(page)
      const liveTime = Number(await canvas.getAttribute('data-sim-time'))
      await touch('touchStart', [{ ...livePoint, id: 1 }])
      await grip(true)
      console.info(`Live grip accepted at width ${viewport.width}`)
      for (let step = 1; step <= 10; step++) {
        await touch('touchMove', [
          { x: livePoint.x + step * 5, y: livePoint.y - step * 2, id: 1 },
        ])
        await page.waitForTimeout(45)
      }
      await touch('touchEnd')
      await grip(false)
      entry.liveTimeAdvanced =
        Number(await canvas.getAttribute('data-sim-time')) - liveTime
      await tap(button('Pause'))
      const afterLive = await read()
      entry.liveHorizontalDisplacement = Math.max(
        ...beforeLive.map((value, index) =>
          index % 4 === 0 || index % 4 === 2
            ? Math.abs(value - afterLive[index])
            : 0,
        ),
      )
      assert.ok(
        entry.liveHorizontalDisplacement > 0.03,
        'An ordinary running touch drag must deform the material',
      )
      assert.ok(
        entry.liveTimeAdvanced > 0.03,
        'Live input must not leave the simulation stalled',
      )
      console.info(
        `Live pull at width ${viewport.width}: ${entry.liveHorizontalDisplacement}`,
      )
      entry.events = await page.evaluate(() => window.__gummyTouchEvents)
      await reset()
      console.info(`Reset for cancellation at width ${viewport.width}`)
      const cancelPoint = await gummyArmPoint(page)
      await touch('touchStart', [{ ...cancelPoint, id: 1 }])
      await grip(true)
      await touch('touchCancel')
      await grip(false)
      entry.cancelled = true
      console.info(`Cancellation passed at width ${viewport.width}`)
      await tap(button('Pan'))
      await canvas.scrollIntoViewIfNeeded()
      const box = await canvas.boundingBox()
      const center = {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        id: 1,
      }
      const beforeCamera = hash(await canvas.screenshot())
      await touch('touchStart', [center])
      await touch('touchMove', [
        { ...center, x: center.x + 40, y: center.y - 12 },
      ])
      await touch('touchEnd')
      await grip(false)
      await page.waitForTimeout(100)
      assert.notEqual(
        beforeCamera,
        hash(await canvas.screenshot()),
        'Camera pan remains available after cancelled grab',
      )
      entry.pan = true
      console.info(`Pan passed at width ${viewport.width}`)
      await page.evaluate(() => {
        document.querySelector('main').scrollTop = 0
        document.querySelector('aside[aria-label="Gummy controls"]').scrollTop =
          0
      })
      const reachable = () =>
        button('Limb pull').evaluate((element) => {
          const rect = element.getBoundingClientRect(),
            x = rect.x + rect.width / 2,
            y = rect.y + rect.height / 2,
            hit = document.elementFromPoint(x, y)
          return (
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight &&
            !!hit &&
            (hit === element || element.contains(hit))
          )
        })
      entry.swipes = 0
      for (let attempt = 0; attempt < 20 && !(await reachable()); attempt++) {
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
        await touch('touchStart', [{ x: origin.x, y: origin.start, id: 1 }])
        for (let step = 1; step <= 10; step++) {
          await touch('touchMove', [
            {
              x: origin.x,
              y: origin.start + ((origin.end - origin.start) * step) / 10,
              id: 1,
            },
          ])
          await page.waitForTimeout(20)
        }
        await touch('touchEnd')
        await page.waitForTimeout(100)
        entry.swipes++
      }
      assert.ok(
        await reachable(),
        'Touch sidebar scrolling must still reveal bottom controls',
      )
      entry.scrolled = true
    } finally {
      entry.events = await page
        .evaluate(() => window.__gummyTouchEvents)
        .catch(() => entry.events)
    }
    for (const type of [
      'pointerdown',
      'gotpointercapture',
      'pointermove',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
    ])
      assert.ok(
        entry.events.some(
          (event) =>
            event.type === type &&
            event.trusted &&
            event.pointerType === 'touch',
        ),
        `${type} must traverse the browser's actual touch transport`,
      )
  }
  assert.deepEqual(report.errors, [], 'No page or GPU errors')
  report.passed = true
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  clearTimeout(timer)
  await browser?.close()
  report.finalDesktop = desktop()
  writeFileSync(
    resolve(output, 'gummy-touch-verification.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.info(
    `Touch report: ${resolve(output, 'gummy-touch-verification.json')}`,
  )
}
