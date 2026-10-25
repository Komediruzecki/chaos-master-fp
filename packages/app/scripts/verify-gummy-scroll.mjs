/** Native wheel/touch regression for reaching the bottom of the integrated gummy controls without locator autoscroll. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const expectFailure = process.env.GUMMY_SCROLL_RED === '1'
const output = resolve(
  process.env.GUMMY_SCROLL_OUTPUT ?? resolve(repo, 'assets'),
)
const cases = expectFailure
  ? [
      { width: 1440, height: 900, input: 'wheel' },
      { width: 390, height: 844, input: 'touch' },
    ]
  : [
      { width: 1440, height: 900 },
      { width: 1440, height: 600 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ].flatMap((viewport) =>
      ['wheel', 'touch'].map((input) => ({ ...viewport, input })),
    )
const report = {
  capturedAt: new Date().toISOString(),
  base,
  expectFailure,
  cases: [],
  errors: [],
  warnings: [],
  failures: [],
}
mkdirSync(output, { recursive: true })
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
let browser, timer

function measure(page) {
  return page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Gummy controls"]')
    const buttons = [...aside.querySelectorAll('button')]
    const target = buttons.at(-1)
    const rect = target.getBoundingClientRect()
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2
    const hit =
      x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight
        ? document.elementFromPoint(x, y)
        : null
    const ancestors = []
    for (let element = aside; element; element = element.parentElement) {
      const style = window.getComputedStyle(element)
      const box = element.getBoundingClientRect()
      ancestors.push({
        tag: element.tagName,
        id: element.id,
        className: element.className,
        top: box.top,
        height: box.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        overflowY: style.overflowY,
        position: style.position,
        touchAction: style.touchAction,
      })
    }
    const side = aside.getBoundingClientRect()
    return {
      width: window.innerWidth,
      contentWidth: document.documentElement.scrollWidth,
      scrollY: window.scrollY,
      target: {
        text: target.textContent.trim(),
        x,
        y,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        selected: target.getAttribute('aria-pressed'),
        reachable:
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight &&
          !!hit &&
          (hit === target || target.contains(hit)),
      },
      aside: { x: side.x, y: side.y, width: side.width, height: side.height },
      ancestors,
    }
  })
}

async function tapControl(page, cdp, input, point) {
  if (input === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.x, y: point.y, id: 1 }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
  } else await page.mouse.click(point.x, point.y)
}

function touchOrigin(page) {
  return page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Gummy controls"]')
    const rect = aside.getBoundingClientRect()
    // Prefer actual sidebar text and fieldset surfaces, avoiding sliders and
    // buttons. Only the first phone swipes need the gutter beside the canvas.
    for (
      let start = window.innerHeight * 0.82;
      start >= window.innerHeight * 0.5;
      start -= 18
    ) {
      for (const fraction of [0.5, 0.25, 0.75]) {
        const x = rect.x + rect.width * fraction
        const hit = document.elementFromPoint(x, start)
        const end = Math.max(
          16,
          rect.top + 8,
          start - window.innerHeight * 0.48,
        )
        if (
          hit &&
          aside.contains(hit) &&
          !hit.closest('button,input,select,textarea') &&
          start - end >= 96
        ) {
          return {
            x,
            start,
            end,
            source: 'controls',
            tag: hit.tagName,
            text: hit.textContent.trim().slice(0, 80),
          }
        }
      }
    }
    // On a short phone the first fold is almost entirely an interactive canvas.
    // Start on actual header/footer text, not its narrow gutter: Chrome can
    // adjust a near-edge touch onto the canvas and correctly consume that drag.
    const textSurfaces = [...document.querySelectorAll('main p, main span')]
      .filter((element) => !element.closest('aside,button,input,a'))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(
        ({ rect }) => rect.top > 30 && rect.bottom < window.innerHeight - 6,
      )
      .sort((a, b) => b.rect.bottom - a.rect.bottom)
    for (const { element, rect } of textSurfaces) {
      const x = rect.x + rect.width / 2
      const start = rect.y + rect.height / 2
      const hit = document.elementFromPoint(x, start)
      const end = Math.max(12, start - window.innerHeight * 0.48)
      if (
        hit &&
        (hit === element || element.contains(hit)) &&
        start - end >= 50
      )
        return {
          x,
          start,
          end,
          source: 'page-text',
          tag: hit.tagName,
          text: hit.textContent.trim().slice(0, 80),
        }
    }
    return {
      x: 7,
      start: window.innerHeight * 0.8,
      end: window.innerHeight * 0.25,
      source: 'page-gutter',
    }
  })
}

try {
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
    report.failures.push('Scroll verification exceeded 240 seconds')
    void browser.close()
  }, 240000)
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
    if (message.type() === 'warning') report.warnings.push(message.text())
  })
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
  assert.deepEqual(report.placement.after, before)
  assert.ok(
    report.placement.clients.length > 0 &&
      report.placement.clients.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace === 'special:agents',
      ),
  )
  const cdp = await context.newCDPSession(page)
  for (const test of cases) {
    await page.setViewportSize({ width: test.width, height: test.height })
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: test.input === 'touch',
      maxTouchPoints: 1,
    })
    await page.goto(
      `${base}/gummy?scroll-check=${test.width}-${test.height}-${test.input}`,
      { waitUntil: 'domcontentloaded' },
    )
    await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
    const initial = await measure(page)
    const entry = { ...test, initial, gestures: 0, touchOrigins: [] }
    report.cases.push(entry)
    assert.equal(
      initial.target.text,
      'Pull to tear',
      'The final protocol button must be the test target',
    )
    assert.equal(
      initial.target.reachable,
      false,
      'The regression must start with lower controls outside the viewport',
    )
    // Desktop gestures begin inside the sidebar. In the stacked phone layout,
    // use the page gutter; the canvas correctly consumes gestures for orbiting.
    const x =
      test.width > 720
        ? Math.min(test.width - 6, initial.aside.x + initial.aside.width - 7)
        : 7
    await page.evaluate(() => {
      window.__gummyScrollInputs = []
      for (const type of ['wheel', 'pointerdown', 'pointerup', 'touchmove'])
        document.addEventListener(
          type,
          (event) =>
            window.__gummyScrollInputs.push({
              type,
              trusted: event.isTrusted,
              pointerType: event.pointerType ?? null,
            }),
          { passive: true },
        )
    })
    for (let attempt = 0; attempt < 16; attempt++) {
      if ((await measure(page)).target.reachable) break
      if (test.input === 'wheel') {
        await page.mouse.move(x, test.height * 0.65)
        await page.mouse.wheel(0, 520)
      } else {
        const origin = await touchOrigin(page)
        entry.touchOrigins.push(origin)
        const { x, start, end } = origin
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y: start, id: 1 }],
        })
        for (let step = 1; step <= 8; step++) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x, y: start + ((end - start) * step) / 8, id: 1 }],
          })
          await page.waitForTimeout(20)
        }
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        })
      }
      entry.gestures++
      await page.waitForTimeout(80)
    }
    entry.final = await measure(page)
    entry.events = await page.evaluate(() => window.__gummyScrollInputs)
    assert.ok(
      entry.events.some(
        (event) =>
          event.trusted &&
          event.type === (test.input === 'wheel' ? 'wheel' : 'touchmove'),
      ),
      'The scrolling test must exercise real browser input',
    )
    const name = `${test.width}x${test.height}-${test.input}`
    await page.screenshot({
      path: resolve(
        output,
        `gummy-scroll-${expectFailure ? 'red-' : ''}${name}.png`,
      ),
    })
    assert.equal(
      entry.final.width,
      entry.final.contentWidth,
      `${name}: the layout must not overflow horizontally`,
    )
    if (expectFailure) {
      assert.equal(
        entry.final.target.reachable,
        false,
        `${name}: reproduce the reported inaccessible controls`,
      )
    } else {
      if (test.input === 'touch')
        assert.ok(
          entry.touchOrigins.some((origin) => origin.source === 'controls'),
          `${name}: swipe inside actual controls after revealing the sidebar`,
        )
      assert.ok(
        entry.final.target.reachable,
        `${name}: wheel/touch must make the last protocol button reachable`,
      )
      // Pull to tear starts selected. Change to its adjacent lower control
      // first so tapping the final button proves a real state transition.
      const alternate = await page.evaluate(() => {
        const button = [...document.querySelectorAll('aside button')].find(
          (element) => element.textContent.trim() === 'Stretch & release',
        )
        const rect = button.getBoundingClientRect(),
          x = rect.x + rect.width / 2,
          y = rect.y + rect.height / 2,
          hit = document.elementFromPoint(x, y)
        return {
          x,
          y,
          selected: button.getAttribute('aria-pressed'),
          reachable:
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight &&
            !!hit &&
            (hit === button || button.contains(hit)),
        }
      })
      assert.equal(alternate.selected, 'false')
      assert.equal(alternate.reachable, true)
      await tapControl(page, cdp, test.input, alternate)
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
            .protocol === 'stretch' &&
          document.querySelector('[data-ready="true"]'),
      )
      const last = (await measure(page)).target
      assert.equal(last.selected, 'false')
      assert.equal(last.reachable, true)
      await tapControl(page, cdp, test.input, last)
      await page.waitForFunction(
        () =>
          [
            ...document.querySelectorAll(
              'aside[aria-label="Gummy controls"] button',
            ),
          ]
            .at(-1)
            .getAttribute('aria-pressed') === 'true' &&
          document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
            .protocol === 'tear' &&
          document.querySelector('[data-ready="true"]'),
      )
      entry.clickedLastControl = true
    }
    console.info(
      JSON.stringify({
        viewport: name,
        gestures: entry.gestures,
        reachable: entry.final.target.reachable,
        scrollingAncestors: entry.final.ancestors
          .filter((ancestor) => ancestor.scrollTop > 0)
          .map((ancestor) => ({
            tag: ancestor.tag,
            scrollTop: ancestor.scrollTop,
          })),
      }),
    )
  }
  await cdp.detach()
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.warnings, [])
  report.passed = true
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  clearTimeout(timer)
  await browser?.close()
  const path = resolve(
    output,
    `gummy-scroll-${expectFailure ? 'red-' : ''}verification.json`,
  )
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  console.info(`Scroll report: ${path}`)
}
