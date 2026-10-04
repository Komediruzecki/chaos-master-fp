/** Native-WebGPU jelly benchmarks, legacy controls, touch coverage and optional fixed-step movies. */
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

const { chromium } = createRequire(import.meta.url)('playwright')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const output = resolve(repo, 'assets')
const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const quick = process.env.GUMMY_QUICK === '1'
const production = process.env.GUMMY_PRODUCTION === '1'
const record = process.env.GUMMY_VIDEO === '1'
const report = {
  base,
  samples: [],
  timings: [],
  errors: [],
  warnings: [],
  failures: [],
}
const movie = record
  ? mkdtempSync(resolve(tmpdir(), 'gummy-jelly-frames-'))
  : undefined
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
const before = desktop()
const existingClients = new Set(hypr('clients').map((client) => client.address))
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
  await page.goto(`${base}/gummy`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
  if (!production)
    await page.waitForFunction(
      () => window.__gummyStudy?.info().experiment === 'jelly',
    )
  report.placement = {
    before,
    after: desktop(),
    clients: hypr('clients')
      .filter((client) => !existingClients.has(client.address))
      .map((client) => ({
        class: client.class,
        workspace: client.workspace.name,
      })),
  }
  assert.deepEqual(
    report.placement.after,
    before,
    'Browser must not change the visible desktop',
  )
  assert.ok(report.placement.clients.length > 0)
  assert.ok(
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
      device: adapter.info.device,
      fallback: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter,
    }
  })
  assert.equal(
    report.adapter.fallback,
    false,
    'Verification requires a native GPU',
  )
  const click = (name) =>
    page.getByRole('button', { name, exact: true }).click()
  const freeze = async () => {
    if (await page.getByRole('button', { name: 'Pause', exact: true }).count())
      await click('Pause')
  }

  async function verifyProduction() {
    report.production = {
      devHookAbsent: await page.evaluate(
        () => window.__gummyStudy === undefined,
      ),
    }
    assert.ok(
      report.production.devHookAbsent,
      'Production must exclude diagnostic API',
    )
    await click('Demo squeeze')
    const started = performance.now()
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
            .steps,
        ) >= 1440,
      undefined,
      { timeout: 60000 },
    )
    report.production.playbackWallSeconds = (performance.now() - started) / 1000
    await freeze()
    await page.screenshot({
      path: resolve(output, 'gummy-jelly-production.png'),
    })
    for (const [width, height, name] of [
      [1024, 768, 'tablet'],
      [390, 844, 'phone'],
    ]) {
      await page.setViewportSize({ width, height })
      await waitForGummyControlsLayout(page)
      const controls = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')].filter(
          (button) => button.getBoundingClientRect().height > 0,
        )
        const action = buttons.find((button) =>
          button.textContent.includes('Replay squeeze'),
        )
        return {
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          background: window.getComputedStyle(action).backgroundColor,
          actionHeight: action.getBoundingClientRect().height,
          choices: buttons
            .filter((button) =>
              [
                'Continuous jelly',
                'Fine crush',
                'Limb pull',
                'Squeeze & release',
                'Stretch & release',
              ].includes(button.textContent.trim()),
            )
            .map((button) => button.getBoundingClientRect().height),
        }
      })
      report[name] = controls
      assert.equal(controls.viewport, controls.document, `${name}: no overflow`)
      assert.equal(
        controls.background,
        'rgb(41, 103, 133)',
        `${name}: compiled action style`,
      )
      assert.ok(
        controls.actionHeight >= 44 &&
          controls.choices.every((height) => height >= 44),
        `${name}: touch target sizes`,
      )
      await page.screenshot({
        path: resolve(output, `gummy-jelly-production-${name}.png`),
        fullPage: true,
      })
    }
  }

  async function verifyDevelopment() {
    let generation = await page.evaluateHandle(() => window.__gummyStudy)
    const refreshGeneration = async () => {
      await generation.dispose()
      generation = await page.evaluateHandle(() => window.__gummyStudy)
    }
    const ensureGeneration = async () => {
      assert.ok(
        await generation.evaluate((study) => study === window.__gummyStudy),
        'Scene changed during capture: stop source edits and rerun',
      )
    }
    let movieFrame = 0
    const captureFrame = async () => {
      const png = await page.evaluate(() => {
        window.__gummyStudy.render()
        return document
          .querySelector('[data-testid="gummy-bear-canvas"]')
          .toDataURL('image/png')
          .split(',')[1]
      })
      assert.ok(png, 'Rendered movie frame must contain pixels')
      writeFileSync(
        resolve(movie, `${String(movieFrame++).padStart(4, '0')}.png`),
        Buffer.from(png, 'base64'),
      )
    }
    const advance = async (count, capture = false) => {
      const started = performance.now()
      const batch = capture && movie ? 4 : 30
      for (let step = 0; step < count; step += batch) {
        await ensureGeneration()
        await page.evaluate(
          async (steps) => {
            await window.__gummyStudy.advanceFrames(steps)
            await window.__gummyStudy.readState()
          },
          Math.min(batch, count - step),
        )
        if (capture && movie) await captureFrame()
      }
      report.timings.push({
        steps: count,
        simulationSeconds: count / 120,
        wallSeconds: (performance.now() - started) / 1000,
        includesFrameCapture: !!(capture && movie),
      })
    }
    const sample = async (name, screenshot = true) => {
      await ensureGeneration()
      const result = await page.evaluate(async (name) => {
        const sim = window.__gummyStudy
        const state = await sim.readState()
        const info = sim.info()
        const { buildGummyBearMesh, tetrahedronVolume } =
          await import('/src/simulation/gummy/gummyMesh.ts')
        const { layGummyBearBack } =
          await import('/src/components/GummyBear/gummyStudyMath.ts')
        const mesh = buildGummyBearMesh(
          info.meshOptions ??
            (info.experiment === 'jelly'
              ? { fracture: 'none', pinnedFeet: info.pose !== 'laid' }
              : info.experiment === 'crush'
                ? { fracture: 'fine', pinnedFeet: false }
                : {}),
        )
        const rest =
          info.pose === 'laid' || info.experiment === 'crush'
            ? layGummyBearBack(mesh.positions)
            : mesh.positions
        const p = state.positions
        const point = (id) => [p[id * 4], p[id * 4 + 1], p[id * 4 + 2]]
        const restPoint = (id) => [
          rest[id * 4],
          rest[id * 4 + 1],
          rest[id * 4 + 2],
        ]
        const distance = (a, b) =>
          Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        let volume = 0,
          invertedVolume = 0,
          inverted = 0,
          edgeStrain2 = 0,
          pinnedMovement = 0,
          floorPenetration = 0,
          pressPenetration = 0
        const min = [Infinity, Infinity, Infinity],
          max = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < p.length; i += 4) {
          for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], p[i + axis])
            max[axis] = Math.max(max[axis], p[i + axis])
          }
          if (p[i + 3] === 0)
            pinnedMovement = Math.max(
              pinnedMovement,
              distance(point(i / 4), restPoint(i / 4)),
            )
          floorPenetration = Math.max(floorPenetration, -Number(p[i + 1]))
          if (
            info.press &&
            Math.abs(p[i]) <= info.press.halfExtent &&
            Math.abs(p[i + 2]) <= info.press.halfExtent
          )
            pressPenetration = Math.max(
              pressPenetration,
              p[i + 1] - info.press.height,
            )
        }
        for (let i = 0; i < mesh.tetrahedra.length; i += 4) {
          const ids = Array.from(mesh.tetrahedra.slice(i, i + 4))
          const v = tetrahedronVolume(...ids.map(point))
          const v0 = tetrahedronVolume(...ids.map(restPoint))
          volume += v
          if (v < 0) {
            inverted++
            invertedVolume -= v
          }
          for (const [a, b] of [
            [0, 1],
            [0, 2],
            [0, 3],
            [1, 2],
            [1, 3],
            [2, 3],
          ]) {
            const stretch =
              distance(point(ids[a]), point(ids[b])) /
                distance(restPoint(ids[a]), restPoint(ids[b])) -
              1
            edgeStrain2 += (v0 * stretch * stretch) / 6
          }
        }
        sim.render()
        return {
          name,
          ...info,
          min,
          max,
          span: max.map((value, axis) => value - min[axis]),
          finite: [...p, ...state.damage].every(Number.isFinite),
          volumeRatio: volume / mesh.restVolume,
          inverted,
          invertedVolumeFraction: invertedVolume / mesh.restVolume,
          edgeStrainRms: Math.sqrt(edgeStrain2 / mesh.restVolume),
          pinnedMovement,
          floorPenetration,
          pressPenetration,
          broken: state.damage.filter((value) => value >= 1).length,
          connectedParts: state.fragments.connectedParts,
        }
      }, name)
      report.samples.push(result)
      console.log(JSON.stringify(result))
      if (screenshot)
        await page.screenshot({
          path: resolve(output, `gummy-jelly-${name}.png`),
        })
      assert.ok(result.finite, `${name}: finite physics state`)
      assert.ok(
        result.pinnedMovement < 1e-5,
        `${name}: anchors must stay fixed`,
      )
      assert.ok(
        result.floorPenetration < 1e-5 && result.pressPenetration < 1e-5,
        `${name}: no collider penetration`,
      )
      if (result.experiment === 'jelly') {
        assert.equal(
          result.connectedParts,
          1,
          `${name}: continuous body stays connected`,
        )
        assert.equal(
          result.interfaces,
          0,
          `${name}: continuous body has no pre-cut seams`,
        )
        assert.equal(result.broken, 0)
        assert.ok(
          result.invertedVolumeFraction < 0.001,
          `${name}: less than 0.1% inverted volume`,
        )
        assert.ok(
          Math.abs(result.volumeRatio - 1) < 0.05,
          `${name}: volume error under 5%`,
        )
      }
      return result
    }
    const reset = async () => {
      await click('Reset bear')
      await freeze()
    }
    const startDemo = async () => {
      await freeze()
      await page.evaluate(() => {
        window.__gummyStudy.startDemoPaused()
      })
    }
    for (const [label, protocol] of [
      ['Squeeze & release', 'squeeze'],
      ['Stretch & release', 'stretch'],
    ]) {
      if (process.env.GUMMY_PROTOCOL && process.env.GUMMY_PROTOCOL !== protocol)
        continue
      await click(label)
      await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
      await refreshGeneration()
      await startDemo()
      movieFrame = 0
      let previous = 0
      const samples = []
      for (const [tick, phase] of [
        [0, 'rest'],
        [120, 'settled'],
        [360, 'loaded'],
        [720, 'held'],
        [900, 'released'],
        [1440, 'recovered'],
      ]) {
        await advance(tick - previous, record)
        previous = tick
        samples.push(await sample(`${protocol}-${phase}`))
      }
      const [, settled, loaded, , , recovered] = samples
      assert.ok(
        loaded.edgeStrainRms > settled.edgeStrainRms + 0.03,
        `${protocol}: loading must visibly deform the volume`,
      )
      assert.ok(
        recovered.edgeStrainRms < loaded.edgeStrainRms * 0.7,
        `${protocol}: release must recover most imposed deformation`,
      )
      assert.ok(
        Math.abs(recovered.volumeRatio - 1) < 0.03,
        `${protocol}: recovered volume within 3%`,
      )
      if (protocol === 'stretch')
        assert.ok(
          recovered.span[1] > samples[0].span[1] * 0.85,
          'Released jelly must recover upright without gravity buckling',
        )
      if (protocol === 'squeeze')
        assert.ok(
          loaded.span[0] > settled.span[0] * 1.02,
          'Compression must bulge laterally',
        )
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
            resolve(output, `gummy-jelly-${protocol}.mp4`),
          ],
          { timeout: 60000 },
        )
    }
    if (!quick) {
      // Repeated reset must restore every solver state, rather than just the visible surface.
      await startDemo()
      await advance(240)
      const first = await page.evaluate(async () =>
        Array.from((await window.__gummyStudy.readState()).positions),
      )
      await startDemo()
      await advance(240)
      const second = await page.evaluate(async () =>
        Array.from((await window.__gummyStudy.readState()).positions),
      )
      report.resetRepeatError = Math.max(
        ...first.map((value, index) => Math.abs(value - second[index])),
      )
      assert.ok(
        report.resetRepeatError < 1e-6,
        'Identical fixed-step replays must agree',
      )
      await reset()
      await click('Grab & pull')
      report.inputs = await checkGummyInputs(page, context)
      for (const [width, height, name] of [
        [1024, 768, 'tablet'],
        [390, 844, 'phone'],
      ]) {
        await page.setViewportSize({ width, height })
        await waitForGummyControlsLayout(page)
        report[name] = await page.evaluate(() => ({
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          canvasCount: document.querySelectorAll(
            '[data-testid="gummy-bear-canvas"]',
          ).length,
          modelButtons: [...document.querySelectorAll('button')]
            .filter((button) =>
              ['Continuous jelly', 'Fine crush', 'Limb pull'].includes(
                button.textContent.trim(),
              ),
            )
            .map((button) => ({
              name: button.textContent.trim(),
              height: button.getBoundingClientRect().height,
            })),
        }))
        assert.equal(
          report[name].document,
          width,
          `${name}: no horizontal overflow`,
        )
        assert.equal(
          report[name].canvasCount,
          1,
          `${name}: only one active simulation canvas`,
        )
        assert.ok(
          report[name].modelButtons.every((button) => button.height >= 44),
          `${name}: model controls have touch targets`,
        )
        await page.screenshot({
          path: resolve(output, `gummy-jelly-${name}.png`),
          fullPage: true,
        })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await waitForGummyControlsLayout(page)
      for (const [label, experiment, demo, ticks] of [
        ['Fine crush', 'crush', 'Demo crush', 1380],
        ['Limb pull', 'pull', 'Demo pull', 600],
      ]) {
        await click(label)
        await page.waitForFunction(
          (name) => window.__gummyStudy?.info().experiment === name,
          experiment,
        )
        await refreshGeneration()
        await click(demo)
        await freeze()
        await advance(ticks)
        const control = await sample(`preserved-${experiment}`)
        assert.ok(
          control.connectedParts >= (experiment === 'crush' ? 20 : 2),
          `${experiment}: preserved fracture behavior`,
        )
      }
    }
  }
  if (production) await verifyProduction()
  else await verifyDevelopment()
  assert.equal(report.errors.length, 0, 'Browser must report no errors')
  assert.equal(report.warnings.length, 0, 'Browser must report no warnings')
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  writeFileSync(
    resolve(
      output,
      production
        ? 'gummy-jelly-production-verification.json'
        : 'gummy-jelly-verification.json',
    ),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await browser?.close()
  if (movie) rmSync(movie, { recursive: true, force: true })
}
