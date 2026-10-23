/** Hardware-WebGPU gummy study captures and finite-state checks in an owned hidden browser. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { checkGummyInputs, waitForGummyControlsLayout, } from './gummy-study-input-checks.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const output = resolve(repo, 'assets')
const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const visualOnly = process.env.GUMMY_VISUAL_ONLY === '1'
const production = process.env.GUMMY_PRODUCTION === '1'
const errors = []
const warnings = []
/** @type {Array<{name: string, finite: boolean, pinnedMovement: number, connectedParts: number, broken: number}>} */
const samples = []
const report = { base, samples, errors, warnings }
mkdirSync(output, { recursive: true })
const hypr = (command) =>
  JSON.parse(execFileSync('hyprctl', ['-j', command], { encoding: 'utf8' }))
const before = {
  window: hypr('activewindow').address,
  workspace: hypr('activeworkspace').id,
}
let browser
try {
  browser = await chromium.launch({
    headless: false,
    env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
    args: [
      '--class=agent-browser',
      // Keep the hidden Wayland surface from limiting rAF to one frame a second.
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
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
    if (message.type() === 'warning') warnings.push(message.text())
  })
  page.setDefaultTimeout(30000)
  await page.goto(`${base}/gummy`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
  await page
    .getByRole('button', {
      name: production ? 'Fine crush' : 'Limb pull',
      exact: true,
    })
    .click()
  await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
  if (!production) await page.waitForFunction(() => !!window.__gummyStudy)
  report.placement = {
    foregroundUnchanged:
      before.window === hypr('activewindow').address &&
      before.workspace === hypr('activeworkspace').id,
    clients: hypr('clients')
      .filter((client) => client.class === 'agent-browser')
      .map((client) => ({
        class: client.class,
        workspace: client.workspace.name,
      })),
    hidden: hypr('monitors').every(
      (monitor) => monitor.specialWorkspace.name !== 'special:agents',
    ),
  }
  if (!report.placement.foregroundUnchanged || !report.placement.hidden)
    throw new Error('Agent browser disturbed the desktop')
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter()
    const info = adapter.info
    return {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      fallback: adapter.isFallbackAdapter,
    }
  })
  const click = (name) =>
    page.getByRole('button', { name, exact: true }).click()
  const freezeReset = async () => {
    await click('Reset bear')
    await click('Pause')
    await page.getByRole('button', { name: 'Resume', exact: true }).waitFor()
  }
  const sample = async (name) => {
    const state = await page.evaluate(async (label) => {
      const sim = window.__gummyStudy
      sim.render()
      const state = await sim.readState()
      const { buildGummyBearMesh, tetrahedronVolume } =
        await import('/src/simulation/gummy/gummyMesh.ts')
      const mesh = buildGummyBearMesh()
      const p = state.positions
      const point = (id) => [p[id * 4], p[id * 4 + 1], p[id * 4 + 2]]
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity]
      let maxMovement = 0,
        pinnedMovement = 0,
        inverted = 0,
        volume = 0,
        invertedVolume = 0
      for (let i = 0; i < p.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[i + k])
          max[k] = Math.max(max[k], p[i + k])
        }
        const moved = Math.hypot(
          p[i] - mesh.positions[i],
          p[i + 1] - mesh.positions[i + 1],
          p[i + 2] - mesh.positions[i + 2],
        )
        maxMovement = Math.max(maxMovement, moved)
        if (p[i + 3] === 0) pinnedMovement = Math.max(pinnedMovement, moved)
      }
      for (let i = 0; i < mesh.tetrahedra.length; i += 4) {
        const v = tetrahedronVolume(
          ...Array.from(mesh.tetrahedra.slice(i, i + 4), point),
        )
        volume += v
        if (v <= 0) {
          inverted++
          invertedVolume -= v
        }
      }
      const parent = [0, 1, 2, 3, 4]
      const root = (id) => (parent[id] === id ? id : root(parent[id]))
      const fractureByRegion = {}
      for (let id = 0; id < state.damage.length; id++) {
        const a = mesh.nodeRegions[mesh.interfaces[id * 8]]
        const b = mesh.nodeRegions[mesh.interfaces[id * 8 + 1]]
        const region = Math.max(a, b)
        fractureByRegion[region] ??= { total: 0, broken: 0 }
        fractureByRegion[region].total++
        if (state.damage[id] >= 1) fractureByRegion[region].broken++
        else parent[root(a)] = root(b)
      }
      return {
        name: label,
        ...sim.info(),
        finite: [...p, ...state.damage].every(Number.isFinite),
        min,
        max,
        maxMovement,
        pinnedMovement,
        volumeRatio: volume / mesh.restVolume,
        inverted,
        invertedVolumeFraction: invertedVolume / mesh.restVolume,
        broken: state.damage.filter((value) => value >= 1).length,
        maxDamage: Math.max(0, ...state.damage),
        connectedParts: new Set(parent.map((_, id) => root(id))).size,
        fractureByRegion,
      }
    }, name)
    report.samples.push(state)
    console.log(JSON.stringify(state))
    await page.screenshot({ path: resolve(output, `gummy-study-${name}.png`) })
    if (name === 'intact' || name.endsWith('tear'))
      await page
        .getByTestId('gummy-bear-canvas')
        .screenshot({ path: resolve(output, `gummy-bear-${name}.png`) })
    if (!state.finite || state.pinnedMovement > 0.00001)
      throw new Error(`Invalid physics state: ${name}`)
  }
  if (production) {
    await page.getByLabel('Marble', { exact: true }).check()
    const replayStarted = performance.now()
    await click('Demo crush')
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector(
          '[data-testid="gummy-bear-canvas"]',
        )
        return Number(canvas.dataset.steps) >= 1152
      },
      undefined,
      { timeout: 60000 },
    )
    report.productionPlaybackWallSeconds =
      (performance.now() - replayStarted) / 1000
    await click('Pause')
    await page.screenshot({
      path: resolve(output, 'gummy-fracture-production.png'),
    })
    report.production = await page.evaluate(() => {
      const demoButton = [...document.querySelectorAll('button')].find(
        (button) =>
          button.textContent.includes('Replay crush') &&
          button.getBoundingClientRect().height > 0,
      )
      return {
        devHookAbsent: window.__gummyStudy === undefined,
        steps: Number(
          document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
            .steps,
        ),
        controlsStyled:
          window.getComputedStyle(demoButton).backgroundColor ===
            'rgb(41, 103, 133)' &&
          demoButton.getBoundingClientRect().height >= 44,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      }
    })
    if (
      !report.production.devHookAbsent ||
      !report.production.controlsStyled ||
      report.production.steps <= 16 ||
      report.production.overflow
    )
      throw new Error('Production integration check failed')
    for (const [width, height, name] of [
      [1024, 768, 'tablet'],
      [390, 844, 'phone'],
    ]) {
      await page.setViewportSize({ width, height })
      await waitForGummyControlsLayout(page)
      await click('Reset bear')
      await click('Pause')
      report[name] = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')].filter(
          (button) =>
            /(?:Demo|Replay) crush/.test(button.textContent) &&
            button.getBoundingClientRect().height > 0,
        )
        const action = buttons[0]
        return {
          visibleDemoButtons: buttons.length,
          height: action?.getBoundingClientRect().height,
          background: action && window.getComputedStyle(action).backgroundColor,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })
      if (
        report[name].visibleDemoButtons !== 1 ||
        report[name].height < 44 ||
        report[name].background !== 'rgb(41, 103, 133)' ||
        report[name].overflow
      )
        throw new Error(`Production ${name} controls failed`)
      await page.screenshot({
        path: resolve(output, `gummy-fracture-production-${name}.png`),
        fullPage: true,
      })
    }
  } else {
    await freezeReset()
    await sample('intact')
    if (!visualOnly) {
      await click('Demo pull')
      await click('Pause')
      let current = 0
      const timings = []
      for (const [target, name] of [
        [240, 'stretch'],
        [600, 'tear'],
        [900, 'settled'],
      ]) {
        while (current < target) {
          const count = Math.min(30, target - current)
          const ms = await page.evaluate(async (steps) => {
            const start = window.performance.now()
            await window.__gummyStudy.advanceFrames(steps)
            await window.__gummyStudy.readState()
            return window.performance.now() - start
          }, count)
          timings.push(ms / count)
          current += count
        }
        await sample(name)
        if (name === 'tear') {
          await page.getByLabel('Candy', { exact: true }).check()
          await sample('candy-tear')
          await page.getByLabel('Marble', { exact: true }).check()
          await sample('marble-tear')
          await page.getByLabel('Blue', { exact: true }).check()
        }
      }
      report.simulationMillisecondsPerStep =
        timings.reduce((sum, ms) => sum + ms, 0) / timings.length
      if (report.samples.at(-1).connectedParts < 2)
        throw new Error('The demonstration did not separate a piece')
      await page.getByLabel('Allow tearing', { exact: true }).uncheck()
      await click('Replay pull')
      await click('Pause')
      for (let batch = 0; batch < 20; batch++)
        await page.evaluate(async () => {
          await window.__gummyStudy.advanceFrames(30)
          await window.__gummyStudy.readState()
        })
      await sample('tearing-disabled')
      if (report.samples.at(-1).broken !== 0)
        throw new Error('Disabled tearing broke an interface')
      await page.getByLabel('Allow tearing', { exact: true }).check()
    }
    await freezeReset()
    await page.getByLabel('Amber', { exact: true }).check()
    await sample('amber')
    await page.getByLabel('Berry', { exact: true }).check()
    await sample('berry')
    for (let turn = 0; turn < 3; turn++)
      await page.getByTestId('gummy-bear-canvas').press('ArrowLeft')
    await page.getByLabel('Candy', { exact: true }).check()
    await sample('candy')
    await page
      .getByTestId('gummy-bear-canvas')
      .screenshot({ path: resolve(output, 'gummy-bear-candy.png') })
    await page.getByLabel('Lagoon', { exact: true }).check()
    await sample('lagoon')
    await page.getByLabel('Marble', { exact: true }).check()
    await sample('marble')
    await page
      .getByTestId('gummy-bear-canvas')
      .screenshot({ path: resolve(output, 'gummy-bear-marble.png') })
    await click('Reset view')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
      window.__gummyStudy.render()
    })
    report.phone = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      canvas: document.querySelector('canvas').getBoundingClientRect().toJSON(),
    }))
    await page.screenshot({
      path: resolve(output, 'gummy-study-phone.png'),
      fullPage: true,
    })
    if (!visualOnly) report.inputs = await checkGummyInputs(page, context)
  }
  if (errors.length) throw new Error(`Browser reported ${errors.length} errors`)
  console.log(
    JSON.stringify({
      adapter: report.adapter,
      placement: report.placement,
      phone: report.phone,
      errors,
    }),
  )
} catch (error) {
  report.errors.push(String(error))
  throw error
} finally {
  writeFileSync(
    resolve(
      output,
      production
        ? 'gummy-fracture-production-verification.json'
        : 'gummy-study-verification.json',
    ),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await browser?.close()
}
