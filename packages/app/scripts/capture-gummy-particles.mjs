/** Native GPU evidence for particle-jelly transport, tensile softening and preserved comparison controls. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { checkGummyInputs, waitForGummyControlsLayout, } from './gummy-study-input-checks.mjs'
import { analyzeParticleState } from './verify-gummy-particle-solver.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const output = resolve(repo, 'assets')
const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const production = process.env.GUMMY_PRODUCTION === '1'
// Production now exposes manual interaction only; retain this entry point by
// delegating to the trusted-pointer production check used by the warm study.
if (production) {
  const { verifyWarmJelly } = await import('./verify-gummy-warm.mjs')
  await verifyWarmJelly()
  process.exit(0)
}
const quick = process.env.GUMMY_QUICK === '1'
const restOnly = process.env.GUMMY_REST_ONLY === '1'
const record = process.env.GUMMY_VIDEO === '1'
const movie = record
  ? mkdtempSync(resolve(tmpdir(), 'gummy-particle-frames-'))
  : undefined
const report = {
  capturedAt: new Date().toISOString(),
  base,
  production,
  quick,
  restOnly,
  recordedVideo: record,
  samples: [],
  timings: [],
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
  monitors: hypr('monitors').map((m) => ({
    id: m.id,
    special: m.specialWorkspace.name,
  })),
})
const before = desktop()
const existing = new Set(hypr('clients').map((c) => c.address))
let browser
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
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
    if (message.type() === 'warning') report.warnings.push(message.text())
  })
  report.placement = {
    before,
    after: desktop(),
    clients: hypr('clients')
      .filter((c) => !existing.has(c.address))
      .map((c) => ({ class: c.class, workspace: c.workspace.name })),
  }
  assert.deepEqual(
    report.placement.after,
    before,
    'Browser must leave the foreground desktop untouched',
  )
  assert.ok(
    report.placement.clients.length > 0 &&
      report.placement.clients.every(
        (c) => c.class === 'agent-browser' && c.workspace === 'special:agents',
      ),
  )
  await page.goto(`${base}/gummy`, { waitUntil: 'domcontentloaded' })
  const click = (name) =>
    page.getByRole('button', { name, exact: true }).click()
  await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
  await click('Particle jelly')
  await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
  await click('Elastic jelly')
  if (!production)
    await page.waitForFunction(() => !!window.__gummyParticleStudy)
  const simulation = !production
    ? await page.evaluateHandle(() => window.__gummyParticleStudy)
    : undefined
  const checkGeneration = async () => {
    if (simulation)
      assert.ok(
        await page.evaluate(
          (original) => window.__gummyParticleStudy === original,
          simulation,
        ),
        'A hot reload invalidated this capture; repeat against a stable generation',
      )
  }
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter()
    return {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      fallback: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter,
    }
  })
  assert.equal(
    report.adapter.fallback,
    false,
    'Particle study requires native GPU evidence',
  )
  const freeze = async () => {
    if (await page.getByRole('button', { name: 'Pause', exact: true }).count())
      await click('Pause')
  }
  let movieFrame = 0
  const advance = async (steps, capture = false) => {
    await checkGeneration()
    const started = performance.now()
    const batch = capture && movie ? 4 : 20
    for (let i = 0; i < steps; i += batch) {
      await page.evaluate(
        async (count) => {
          window.__gummyParticleStudy.advanceFrames(count)
          await window.__gummyParticleStudy.readState()
        },
        Math.min(batch, steps - i),
      )
      if (capture && movie) {
        const png = await page.evaluate(() => {
          window.__gummyParticleStudy.render()
          return document
            .querySelector('[data-testid="gummy-bear-canvas"]')
            .toDataURL('image/png')
            .split(',')[1]
        })
        writeFileSync(
          resolve(movie, `${String(movieFrame++).padStart(4, '0')}.png`),
          Buffer.from(png, 'base64'),
        )
      }
    }
    report.timings.push({
      steps,
      simulationSeconds: steps / 120,
      wallSeconds: (performance.now() - started) / 1000,
      includesFrameCapture: !!(capture && movie),
    })
  }
  const sample = async (name) => {
    await checkGeneration()
    const { info, state } = await page.evaluate(async () => {
      const sim = window.__gummyParticleStudy
      const info = sim.info()
      const snapshot = await sim.readState()
      sim.render()
      return {
        info,
        state: Object.fromEntries(
          Object.entries(snapshot).map(([key, value]) => [
            key,
            ArrayBuffer.isView(value) ? Array.from(value) : value,
          ]),
        ),
      }
    })
    const data = {
      name,
      ...info,
      ...analyzeParticleState(state, state.restPositions, info.spacing),
    }
    report.samples.push(data)
    console.log(JSON.stringify(data))
    await page.screenshot({
      path: resolve(output, `gummy-particle-${name}.png`),
    })
    if (['rest', 'neck', 'released'].includes(name)) {
      for (const { suffix, options } of [
        { suffix: 'raw', options: { raw: true } },
        { suffix: 'clay', options: { clay: true } },
      ]) {
        const png = await page.evaluate((options) => {
          window.__gummyParticleStudy.render(options)
          return document
            .querySelector('[data-testid="gummy-bear-canvas"]')
            .toDataURL('image/png')
            .split(',')[1]
        }, options)
        writeFileSync(
          resolve(output, `gummy-particle-${name}-${suffix}.png`),
          Buffer.from(png, 'base64'),
        )
      }
    }
    assert.ok(data.finite, `${name}: all solver state must be finite`)
    assert.ok(data.pinMovement < 1e-5, `${name}: fixed feet must stay fixed`)
    assert.ok(data.min[1] >= -1e-5, `${name}: floor cannot be penetrated`)
    assert.equal(
      data.guardActivations,
      0,
      `${name}: the default benchmark must not rely on numerical corrections`,
    )
    assert.equal(
      data.domainContacts,
      0,
      `${name}: remain inside the study domain`,
    )
    assert.equal(
      data.particleCount,
      report.samples[0].particleCount,
      `${name}: no particles may disappear`,
    )
    return data
  }
  if (restOnly) {
    assert.equal(production, false)
    await page.evaluate(() => {
      window.__gummyParticleStudy.startDemoPaused()
    })
    await sample('rest')
    await page.locator('[data-testid="gummy-bear-canvas"]').focus()
    for (const [turns, view] of [
      [12, 'side'],
      [23, 'back'],
    ]) {
      for (let i = 0; i < turns; i++) await page.keyboard.press('ArrowRight')
      await page.evaluate(() => {
        window.__gummyParticleStudy.render()
      })
      await page.screenshot({
        path: resolve(output, `gummy-particle-rest-${view}.png`),
      })
    }
    await click('Reset view')
  } else {
    await freeze()
    await page.getByLabel('Allow tearing', { exact: true }).check()
    await click('Reset bear')
    await freeze()
    const idleTicks = await page.evaluate(
      () => window.__gummyParticleStudy.info().tick,
    )
    await advance(1200 - idleTicks)
    const idle = await sample('idle')
    await page.evaluate(() => {
      window.__gummyParticleStudy.startDemoPaused()
    })
    let previous = 0
    let torn
    for (const [tick, phase] of [
      [0, 'rest'],
      [120, 'settled'],
      [360, 'loading'],
      [600, 'neck'],
      [840, 'released'],
      [1020, 'recovering'],
      [1440, 'final'],
    ]) {
      await advance(tick - previous, record)
      previous = tick
      const data = await sample(phase)
      if (phase === 'final') torn = data
    }
    if (movie)
      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-loglevel',
          'error',
          '-framerate',
          '30',
          '-i',
          resolve(movie, '%04d.png'),
          '-vf',
          'pad=ceil(iw/2)*2:ceil(ih/2)*2',
          '-c:v',
          'libx264',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          resolve(output, 'gummy-particle-demo.mp4'),
        ],
        { timeout: 60000 },
      )
    await page.getByLabel('Allow tearing', { exact: true }).uncheck()
    await page.evaluate(() => {
      window.__gummyParticleStudy.startDemoPaused()
    })
    await advance(840)
    const control = await sample('softening-disabled')
    assert.equal(
      control.damageMax,
      0,
      'Disabled softening must retain undamaged material',
    )
    await advance(600)
    const recovered = await sample('softening-disabled-recovered')
    assert.equal(recovered.damageMax, 0)
    assert.ok(
      recovered.freeDisplacementRms < 0.1,
      'The undamaged material must recover its rest shape after release',
    )
    assert.ok(
      Math.abs(recovered.meanJ - 1) < 0.03,
      'The undamaged material must recover its rest volume',
    )
    assert.ok(torn)
    assert.ok(
      torn.damaged > 0,
      'The enabled pull must actually soften material',
    )
    assert.ok(
      torn.components.length > 1,
      'The enabled pull must detach material',
    )
    assert.ok(
      torn.components[0] > 0.8 * torn.particleCount,
      'Local pulling must preserve the main body',
    )
    for (const region of torn.materialRegions.filter((entry) =>
      ['head', 'feet'].includes(entry.name),
    ))
      assert.equal(
        region.damaged,
        0,
        `${region.name}: damage must remain local`,
      )
    assert.equal(
      idle.damageMax,
      0,
      'Gravity alone must not damage the upright bear',
    )
    assert.equal(
      idle.components.length,
      1,
      'The idle bear must remain connected',
    )
    assert.ok(
      idle.span[1] > 0.9 * (idle.restBounds.max[1] - idle.restBounds.min[1]),
      'The upright bear must hold its height under gravity',
    )
    assert.equal(
      control.components.length,
      1,
      'The undamaged material must remain connected under the demo load',
    )
    assert.equal(
      recovered.components.length,
      1,
      'The undamaged material must remain connected after recovery',
    )
    if (!quick) {
      await page.getByLabel('Allow tearing', { exact: true }).check()
      await click('Grab & pull')
      report.inputs = await checkGummyInputs(page, context)
      for (const label of [
        'Continuous jelly',
        'Fine crush',
        'Limb pull',
        'Particle jelly',
      ]) {
        await click(label)
        await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
        assert.equal(
          await page.locator('[data-testid="gummy-bear-canvas"]').count(),
          1,
          'Switching models must dispose the prior canvas',
        )
      }
    }
  }
  for (const [width, height, name] of [
    [1024, 768, 'tablet'],
    [390, 844, 'phone'],
  ]) {
    await page.setViewportSize({ width, height })
    await waitForGummyControlsLayout(page)
    report[name] = await page.evaluate(() => ({
      width: window.innerWidth,
      content: document.documentElement.scrollWidth,
      choices: [...document.querySelectorAll('button')]
        .filter((b) =>
          [
            'Continuous jelly',
            'Fine crush',
            'Limb pull',
            'Particle jelly',
          ].includes(b.textContent.trim()),
        )
        .map((b) => b.getBoundingClientRect().height),
    }))
    assert.equal(report[name].width, report[name].content)
    assert.ok(report[name].choices.every((height) => height >= 44))
    await page.screenshot({
      path: resolve(
        output,
        `gummy-particle-${production ? 'production-' : ''}${name}.png`,
      ),
      fullPage: true,
    })
  }
  assert.equal(report.errors.length, 0, 'No browser errors')
  assert.equal(report.warnings.length, 0, 'No browser warnings')
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  writeFileSync(
    resolve(
      output,
      `gummy-particle-${production ? 'production-' : restOnly ? 'rest-' : ''}verification.json`,
    ),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await browser?.close()
  if (movie) rmSync(movie, { recursive: true, force: true })
}
