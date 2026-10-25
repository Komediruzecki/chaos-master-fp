/** Native GPU verification of runtime jelly cracks, including live topology and preserved controls. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { analyzeRuntimeJelly } from './gummy-jelly-topology-checks.mjs'
import { checkGummyManualTearing } from './gummy-manual-tear-checks.mjs'
import { checkGummyInputs, waitForGummyControlsLayout, } from './gummy-study-input-checks.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const output = resolve(repo, 'assets')
const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const quick = process.env.GUMMY_QUICK === '1'
const statesDirectory = process.env.GUMMY_STATES_DIR
const production = process.env.GUMMY_PRODUCTION === '1'
const manual = production || process.env.GUMMY_MANUAL === '1'
const tearResponse = process.env.GUMMY_TEAR_RESPONSE ?? 'crumble'
assert.ok(['soft', 'crumble'].includes(tearResponse))
const geometry = process.env.GUMMY_GEOMETRY ?? 'standard'
assert.ok(['standard', 'fine'].includes(geometry))
const idleProbe = process.env.GUMMY_IDLE_PROBE === '1'
assert.ok(!idleProbe || !production)
const manualPrefix =
  process.env.GUMMY_CAPTURE_PREFIX ??
  `${tearResponse === 'soft' ? 'gummy-soft' : 'gummy-hot'}${geometry === 'fine' ? '-fine' : ''}${idleProbe ? '-idle' : ''}`
const movie =
  process.env.GUMMY_VIDEO === '1'
    ? mkdtempSync(resolve(tmpdir(), 'gummy-tear-frames-'))
    : undefined
const report = {
  base,
  tearResponse,
  geometry,
  idleProbe,
  capturePrefix: manualPrefix,
  samples: [],
  timings: [],
  errors: [],
  warnings: [],
  failures: [],
}
mkdirSync(output, { recursive: true })
if (statesDirectory) mkdirSync(statesDirectory, { recursive: true })
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
const clients = new Set(hypr('clients').map((c) => c.address))
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
  page.setDefaultTimeout(60000)
  page.on('pageerror', (e) => report.errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
    if (m.type() === 'warning') report.warnings.push(m.text())
  })
  await page.goto(`${base}/gummy`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-ready="true"]')
  report.placement = {
    before,
    after: desktop(),
    clients: hypr('clients')
      .filter((c) => !clients.has(c.address))
      .map((c) => ({ class: c.class, workspace: c.workspace.name })),
  }
  assert.deepEqual(
    report.placement.after,
    before,
    'Keep the visible desktop unchanged',
  )
  assert.ok(report.placement.clients.length > 0)
  assert.ok(
    report.placement.clients.every(
      (c) => c.class === 'agent-browser' && c.workspace === 'special:agents',
    ),
  )
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter()
    return {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      fallback: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter,
    }
  })
  assert.equal(report.adapter.fallback, false, 'Use native WebGPU')
  const click = (name) =>
    page.getByRole('button', { name, exact: true }).click()
  const freeze = async () => {
    if (await page.getByRole('button', { name: 'Pause', exact: true }).count())
      await click('Pause')
  }
  await click('Pull to tear')
  await click(geometry === 'fine' ? 'Fine' : 'Standard')
  await page.waitForSelector('[data-ready="true"]')
  await click(tearResponse === 'soft' ? 'Soft tear' : 'Crumble')
  await page.waitForSelector('[data-ready="true"]')
  if (!manual) await page.getByRole('slider', { name: /Fragility/ }).fill('0')
  if (manual) {
    await checkGummyManualTearing(page, context, output, production, report)
    if (!quick && !production)
      report.inputs = await checkGummyInputs(page, context)
    if (!production) {
      await click('Continuous jelly')
      await page.waitForSelector('[data-ready="true"]')
      await click('Pull to tear')
      await page.waitForSelector('[data-ready="true"]')
      await freeze()
      const beforeSwitch = await page.evaluate(() => window.__gummyStudy.info())
      const modes = []
      for (const preset of ['standard', 'fine', geometry]) {
        await click(preset === 'fine' ? 'Fine' : 'Standard')
        await page.waitForSelector('[data-ready="true"]')
        await freeze()
        const info = await page.evaluate(() => window.__gummyStudy.info())
        assert.equal(info.geometry, preset)
        assert.equal(info.meshOptions.spacing, preset === 'fine' ? 0.1 : 0.14)
        assert.equal(info.solverSubsteps, preset === 'fine' ? 2 : 1)
        assert.deepEqual(info.settings, beforeSwitch.settings)
        assert.equal(info.topologyRevision, 0)
        modes.push({
          preset,
          tetrahedra: info.tetrahedra,
          vertices: info.vertices,
          solverSubsteps: info.solverSubsteps,
        })
      }
      assert.ok(modes[1].tetrahedra > modes[0].tetrahedra * 2)
      report.geometrySwitching = modes
    }
  } else {
    await page.waitForFunction(
      () => window.__gummyStudy?.info().protocol === 'tear',
    )
    await freeze()
    const generation = await page.evaluateHandle(() => window.__gummyStudy)
    const ensureGeneration = async () => {
      assert.ok(
        await generation.evaluate((g) => g === window.__gummyStudy),
        'Source changed during native verification',
      )
    }
    let movieFrame = 0
    const advance = async (count, record = false) => {
      const start = performance.now()
      const batch = record && movie ? 4 : 60
      for (let i = 0; i < count; i += batch) {
        await ensureGeneration()
        await page.evaluate(
          async (n) => {
            await window.__gummyStudy.advanceFrames(n)
          },
          Math.min(batch, count - i),
        )
        if (record && movie) {
          const png = await page.evaluate(() => {
            window.__gummyStudy.render()
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
        steps: count,
        simulationSeconds: count / 120,
        wallSeconds: (performance.now() - start) / 1000,
        capture: record && !!movie,
      })
    }
    let initialTopology
    const sample = async (name, screenshot = false) => {
      await ensureGeneration()
      const state = await page.evaluate(async () => {
        const state = await window.__gummyStudy.readState()
        const copy = (v) =>
          ArrayBuffer.isView(v)
            ? Array.from(v)
            : Array.isArray(v)
              ? v.map(copy)
              : v && typeof v === 'object'
                ? Object.fromEntries(
                    Object.entries(v).map(([k, x]) => [k, copy(x)]),
                  )
                : v
        return copy(state)
      })
      if (statesDirectory)
        writeFileSync(
          resolve(statesDirectory, `${name}.json`),
          JSON.stringify(state),
        )
      assert.ok(
        state.dynamic?.velocities?.length,
        'Dynamic velocity state must be available',
      )
      initialTopology ??= state.topology
      const result = {
        name,
        ...analyzeRuntimeJelly(state, initialTopology),
        info: await page.evaluate(() => window.__gummyStudy.info()),
      }
      report.samples.push(result)
      console.log(
        JSON.stringify({
          name,
          vertices: result.vertexCount,
          revision: result.revision,
          failed: result.failedFaces,
          parts: result.mechanicalComponents.length,
          volume: result.volumeRatio,
          inversion: result.invertedVolumeFraction,
          nonManifold: result.nonManifoldEdges,
        }),
      )
      if (screenshot)
        await page.screenshot({
          path: resolve(output, `gummy-jelly-tear-${name}.png`),
        })
      assert.ok(result.finite, `${name}: finite state`)
      assert.ok(
        result.pinnedMovement < 1e-5 && result.floorPenetration < 1e-5,
        `${name}: respect pins and floor`,
      )
      for (const key of [
        'missingBoundaryFaces',
        'extraSurfaceFaces',
        'orientationErrors',
        'invalidCapPairs',
        'dyeMismatch',
        'originalMaterialMismatch',
        'materialCornerMismatches',
        'openSurfaceEdges',
        'windingErrors',
      ])
        assert.equal(result[key], 0, `${name}: ${key}`)
      // Finish the trajectory for diagnosis, while keeping both limits fatal to the run.
      if (!(result.invertedVolumeFraction < 0.001))
        report.failures.push(`${name}: inverted volume must stay below 0.1%`)
      if (!(Math.abs(result.volumeRatio - 1) < 0.05))
        report.failures.push(`${name}: volume error must stay below 5%`)
      return result
    }
    const start = () =>
      page.evaluate(() => {
        window.__gummyStudy.startDemoPaused()
        window.scrollTo(0, 0)
      })
    const tearing = page.getByRole('checkbox', { name: 'Allow tearing' })
    if (process.env.GUMMY_BASELINE_ONLY === '1') await tearing.uncheck()
    await start()
    const rest = await sample('rest', true)
    await click('Reset bear')
    await freeze()
    await advance(1200)
    const idle = await sample('idle')
    assert.equal(
      idle.revision,
      0,
      'Gravity alone cannot crack the resting bear',
    )
    assert.equal(
      idle.failedFaces,
      0,
      'Gravity must not create hidden damage in a still-connected star',
    )
    await tearing.uncheck()
    await start()
    await advance(720)
    const elastic = await sample('disabled-loaded', true)
    await advance(720)
    const recovered = await sample('disabled-recovered', true)
    assert.equal(
      recovered.vertexCount,
      rest.vertexCount,
      'Disabled tearing keeps shared nodes',
    )
    assert.equal(recovered.failedFaces, 0)
    assert.equal(recovered.mechanicalComponents.length, 1)
    assert.ok(
      recovered.edgeStrainRms < elastic.edgeStrainRms * 0.7,
      'Intact material recovers after the same pull',
    )
    if (process.env.GUMMY_BASELINE_ONLY === '1') {
      console.log(
        'Saved intact rest, idle, loaded and recovered material snapshots.',
      )
      await browser.close()
      browser = undefined
    } else {
      await tearing.check()
      await start()
      let previous = 0
      const enabled = []
      for (const [tick, name] of [
        [120, 'settled'],
        [360, 'loading'],
        [600, 'loaded'],
        [840, 'release'],
        [1020, 'falling'],
        [1440, 'settled-pieces'],
      ]) {
        await advance(tick - previous, true)
        previous = tick
        const s = await sample(name, true)
        assert.equal(s.tetCount, rest.tetCount, 'Keep every tetrahedron')
        assert.ok(
          Math.abs(s.restVolume / rest.restVolume - 1) < 1e-10,
          'Conserve rest volume',
        )
        assert.ok(
          Math.abs(s.freeMass / rest.freeMass - 1) < 1e-6,
          'Conserve inertial mass',
        )
        enabled.push(s)
      }
      const final = enabled.at(-1)
      assert.ok(
        final.vertexCount > rest.vertexCount &&
          final.failedFaces > 0 &&
          final.capPairs > 0,
        'Tensile load must create actual cracks',
      )
      assert.ok(
        final.mechanicalComponents.some(
          (c) => !c.pinned && c.restVolume > rest.restVolume * 0.001,
        ),
        'A real free fragment must detach without even a point bridge',
      )
      const release = enabled[3]
      const detached = release.mechanicalComponents.filter((c) => !c.pinned)
      report.detachedMovement = Math.max(
        0,
        ...detached.map((c) => {
          const after = final.mechanicalComponents.find(
            (p) => p.firstTet === c.firstTet && p.tetCount === c.tetCount,
          )
          return after
            ? Math.hypot(...after.centre.map((v, a) => v - c.centre[a]))
            : 0
        }),
      )
      assert.ok(
        report.detachedMovement > 0.1,
        'Released fragments move independently',
      )
      await start()
      const reset = await sample('reset')
      assert.equal(reset.vertexCount, rest.vertexCount)
      assert.equal(reset.failedFaces, 0)
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
            resolve(output, 'gummy-jelly-tear.mp4'),
          ],
          { timeout: 60000 },
        )
      if (!quick) report.inputs = await checkGummyInputs(page, context)
    }
  }
  if (browser) {
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
        choices: [...document.querySelectorAll('button')]
          .filter((b) =>
            [
              'Pull to tear',
              'Squeeze & release',
              'Stretch & release',
              'Continuous jelly',
              'Particle jelly',
              'Fine crush',
              'Limb pull',
              'Soft tear',
              'Crumble',
              'Standard',
              'Fine',
              'Original',
              'Rounded',
            ].includes(b.textContent.trim()),
          )
          .map((b) => ({
            label: b.textContent.trim(),
            height: b.getBoundingClientRect().height,
          })),
        materialControls: [
          ...document.querySelectorAll(
            'input[type="range"], input[type="checkbox"]',
          ),
        ]
          .filter((input) => input.getBoundingClientRect().height > 0)
          .map((input) => ({
            label: input.labels?.[0]?.textContent.trim(),
            height: (input.type === 'checkbox'
              ? input.closest('label')
              : input
            ).getBoundingClientRect().height,
          })),
      }))
      assert.equal(
        report[name].document,
        width,
        `${name}: no horizontal overflow`,
      )
      assert.equal(report[name].canvasCount, 1)
      assert.ok(
        report[name].choices.every((b) => b.height >= 44),
        `${name}: touch targets`,
      )
      assert.ok(report[name].materialControls.length >= 3)
      assert.ok(
        report[name].materialControls.every((control) => control.height >= 44),
        `${name}: material control touch targets`,
      )
      await page.screenshot({
        path: resolve(
          output,
          `${manual ? manualPrefix : 'gummy-jelly-tear'}-${production ? 'production-' : ''}${name}.png`,
        ),
        fullPage: true,
      })
    }
    if (!production && !quick) {
      for (const [label, protocol] of [
        ['Squeeze & release', 'squeeze'],
        ['Stretch & release', 'stretch'],
      ]) {
        await click(label)
        await page.waitForFunction(
          (p) => window.__gummyStudy?.info().protocol === p,
          protocol,
        )
        assert.equal(
          await page
            .getByRole('checkbox', { name: 'Allow tearing' })
            .isDisabled(),
          true,
        )
      }
      for (const [label, experiment] of [
        ['Particle jelly', 'particle'],
        ['Fine crush', 'crush'],
        ['Limb pull', 'pull'],
        ['Continuous jelly', 'jelly'],
      ]) {
        await click(label)
        await page.waitForSelector('[data-ready="true"]')
        await page.waitForFunction(
          (e) =>
            e === 'particle'
              ? !!window.__gummyParticleStudy
              : window.__gummyStudy?.info().experiment === e,
          experiment,
        )
        assert.equal(await page.getByTestId('gummy-bear-canvas').count(), 1)
      }
    }
  }
  assert.deepEqual(
    report.failures,
    [],
    'Every sampled state must pass its numerical limits',
  )
  assert.equal(report.errors.length, 0, 'No browser errors')
  assert.equal(report.warnings.length, 0, 'No browser warnings')
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  writeFileSync(
    resolve(
      output,
      `${manual ? manualPrefix : 'gummy-jelly-tear'}-${production ? 'production-' : ''}verification.json`,
    ),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await browser?.close()
  if (movie) rmSync(movie, { recursive: true, force: true })
}
