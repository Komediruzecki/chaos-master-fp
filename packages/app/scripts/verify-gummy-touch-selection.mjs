/** Trusted mobile touch selection/cancellation checks; Chromium cannot emulate UIKit recognizers. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { gummyArmPoint, waitForGummyControlsLayout, } from './gummy-study-input-checks.mjs'

const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const output = resolve(
  process.env.GUMMY_TOUCH_SELECTION_OUTPUT ?? '/tmp/gummy-touch-selection',
)
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
const before = desktop(),
  clientsBefore = new Set(hypr('clients').map((client) => client.address))
const report = {
  startedAt: new Date().toISOString(),
  base,
  cases: [],
  errors: [],
  warnings: [],
  failures: [],
}
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
    report.failures.push('Touch selection verification exceeded 90 seconds')
    void browser.close()
  }, 90000)
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
    if (message.type() === 'warning') report.warnings.push(message.text())
  })
  await page.goto(`${base}/gummy?experiment=mpm`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForFunction(
    () =>
      window.__gummyParticleStudy &&
      document.querySelector('[data-ready="true"]'),
    undefined,
    { timeout: 30000 },
  )
  assert.deepEqual(desktop(), before, 'Browser must not take foreground focus')
  const clients = hypr('clients').filter(
    (client) => !clientsBefore.has(client.address),
  )
  assert.ok(
    clients.length &&
      clients.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace.name === 'special:agents',
      ),
  )
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter()
    return {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      fallback:
        adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
    }
  })
  assert.equal(report.adapter.fallback, false)
  const canvas = page.getByTestId('gummy-bear-canvas')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  })
  const touch = (type, points = []) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
  ]) {
    const entry = { viewport, events: [] }
    report.cases.push(entry)
    await page.setViewportSize(viewport)
    await waitForGummyControlsLayout(page)
    await page.evaluate(() => {
      window.__gummyParticleStudy.resetPaused()
      window.getSelection()?.removeAllRanges()
    })
    await canvas.scrollIntoViewIfNeeded()
    await canvas.press('Home')
    entry.styles = await canvas.evaluate((element) => {
      const studio = element.closest('section'),
        slot = element.parentElement.parentElement
      return {
        canvasSelect: window.getComputedStyle(element).userSelect,
        canvasTouchAction: window.getComputedStyle(element).touchAction,
        slotSelect: window.getComputedStyle(slot).userSelect,
        studioSelect: window.getComputedStyle(studio).userSelect,
        studioCallout: window
          .getComputedStyle(studio)
          .getPropertyValue('-webkit-touch-callout'),
      }
    })
    assert.equal(entry.styles.canvasTouchAction, 'none')
    assert.equal(entry.styles.canvasSelect, 'none')
    assert.equal(
      entry.styles.studioSelect,
      'none',
      'The surrounding studio must reject selection too',
    )
    await page.evaluate(() => {
      window.__touchSelectionTrace = []
      for (const type of [
        'touchstart',
        'touchmove',
        'touchend',
        'touchcancel',
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
      ])
        document.addEventListener(
          type,
          (event) =>
            window.__touchSelectionTrace.push({
              type,
              trusted: event.isTrusted,
              target: event.target.tagName,
              prevented: event.defaultPrevented,
            }),
          { passive: true },
        )
    })
    const point = await gummyArmPoint(page)
    assert.equal(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        point,
      ),
      'CANVAS',
    )
    try {
      await touch('touchStart', [{ ...point, id: 1 }])
      await page.waitForTimeout(750)
      await page.waitForFunction(() => window.__gummyParticleStudy.info().grip)
      entry.gripped = true
      const start = await page.evaluate(
        () => window.__gummyParticleStudy.info().gripCommand.target,
      )
      for (let step = 1; step <= 6; step++)
        await touch('touchMove', [
          { x: point.x + step * 6, y: point.y - step * 2, id: 1 },
        ])
      const end = await page.evaluate(
        () => window.__gummyParticleStudy.info().gripCommand.target,
      )
      entry.dragDistance = Math.hypot(
        ...start.map((value, index) => end[index] - value),
      )
      assert.ok(
        entry.dragDistance > 0.04,
        'The held finger must move the active material grip',
      )
      await touch('touchEnd')
      await page.waitForFunction(() => !window.__gummyParticleStudy.info().grip)
      entry.released = true
      entry.selection = await page.evaluate(() => String(window.getSelection()))
      assert.equal(entry.selection, '')
      entry.events = await page.evaluate(() => window.__touchSelectionTrace)
      for (const type of ['touchstart', 'touchmove']) {
        const events = entry.events.filter(
          (event) => event.type === type && event.target === 'CANVAS',
        )
        assert.ok(
          events.length > 0 &&
            events.every((event) => event.trusted && event.prevented),
          `${type} must actively cancel native selection before it starts`,
        )
      }
      console.info(
        `Long touch drag, native cancellation and release passed at ${viewport.width}px`,
      )
      const swipe = await page.evaluate(() => {
        const main = document.querySelector('main'),
          aside = document.querySelector('aside[aria-label="Gummy controls"]')
        if (window.innerWidth < 720)
          return {
            x: 7,
            start: window.innerHeight * 0.8,
            end: window.innerHeight * 0.3,
            target: 'main',
            before: main.scrollTop,
          }
        const rect = aside.getBoundingClientRect()
        for (
          let y = window.innerHeight * 0.8;
          y > window.innerHeight * 0.45;
          y -= 20
        ) {
          for (const fraction of [0.5, 0.25, 0.75]) {
            const x = rect.x + rect.width * fraction,
              hit = document.elementFromPoint(x, y)
            if (
              hit &&
              aside.contains(hit) &&
              !hit.closest('button,input,select,textarea,a')
            )
              return {
                x,
                start: y,
                end: y - 220,
                target: 'main',
                before: main.scrollTop,
              }
          }
        }
        throw new Error('No unobstructed sidebar swipe origin')
      })
      await touch('touchStart', [{ x: swipe.x, y: swipe.start, id: 1 }])
      for (let step = 1; step <= 8; step++) {
        await touch('touchMove', [
          {
            x: swipe.x,
            y: swipe.start + ((swipe.end - swipe.start) * step) / 8,
            id: 1,
          },
        ])
        await page.waitForTimeout(20)
      }
      await touch('touchEnd')
      await page.waitForTimeout(100)
      entry.scrollDelta = await page.evaluate(
        ({ target, before }) =>
          document.querySelector(target).scrollTop - before,
        swipe,
      )
      assert.ok(
        entry.scrollDelta > 20,
        'A swipe outside the canvas must still scroll the page or sidebar',
      )
      console.info(`Outside canvas scrolling passed at ${viewport.width}px`)
    } finally {
      entry.events = await page
        .evaluate(() => window.__touchSelectionTrace)
        .catch(() => entry.events)
    }
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.warnings, [])
  report.passed = true
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  clearTimeout(timer)
  await browser?.close()
  report.finalDesktop = desktop()
  writeFileSync(
    resolve(output, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.info(`Touch selection report: ${resolve(output, 'report.json')}`)
}
