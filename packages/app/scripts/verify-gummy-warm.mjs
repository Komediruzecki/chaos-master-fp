/** Native GPU short-pull/contact comparison with trusted pointer input and separately timed live playback. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { waitForGummyControlsLayout } from './gummy-study-input-checks.mjs'
import { analyzeParticleState } from './verify-gummy-particle-solver.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const production = process.env.GUMMY_PRODUCTION === '1'
const output = resolve(process.env.GUMMY_WARM_OUTPUT ?? resolve(repo, 'assets'))
const timeoutSeconds = Number(process.env.GUMMY_WARM_TIMEOUT ?? 480)
const liveSeconds = Number(process.env.GUMMY_WARM_LIVE_SECONDS ?? 5)

/** Material labels come from the original samples, never the displayed blended colour. */
export function blobContactMetrics(state, spacing) {
  const groups = [[], []]
  for (let i = 0; i < state.positions.length; i += 4)
    groups[state.restPositions[i] < 0 ? 0 : 1].push(
      state.positions.slice(i, i + 3),
    )
  assert.ok(
    groups.every((group) => group.length > 0),
    'Both blob labels must survive',
  )
  const centroid = (group) =>
    [0, 1, 2].map(
      (axis) =>
        group.reduce((sum, point) => sum + point[axis], 0) / group.length,
    )
  let minimumDistance = Infinity
  const nearLeft = new Set(),
    nearRight = new Set()
  for (let left = 0; left < groups[0].length; left++)
    for (let right = 0; right < groups[1].length; right++) {
      const a = groups[0][left],
        b = groups[1][right]
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
      minimumDistance = Math.min(minimumDistance, distance)
      if (distance <= spacing * 1.9) {
        nearLeft.add(left)
        nearRight.add(right)
      }
    }
  return {
    labels: groups.map((group) => ({
      count: group.length,
      centroid: centroid(group),
    })),
    minimumCrossLabelDistance: minimumDistance,
    nearContactCounts: [nearLeft.size, nearRight.size],
    contactRadius: spacing * 1.9,
    interpretation:
      'Geometric proximity and labelled motion; this does not demonstrate a persistent adhesive bond.',
  }
}

function sourceHashes() {
  const directories = [
    'packages/app/src/simulation/gummy',
    'packages/app/src/components/GummyBear',
    'packages/app/src/pages/GummyBear',
  ]
  return Object.fromEntries(
    directories.flatMap((directory) =>
      readdirSync(resolve(repo, directory))
        .filter(
          (file) => /\.(tsx?|wgsl|css)$/.test(file) && !file.includes('.test.'),
        )
        .sort()
        .map((file) => {
          const path = `${directory}/${file}`
          return [
            path,
            createHash('sha256')
              .update(readFileSync(resolve(repo, path)))
              .digest('hex'),
          ]
        }),
    ),
  )
}

function selfTest() {
  const state = {
    restPositions: [-1, 0, 0, 1, 1, 0, 0, 1],
    positions: [-0.05, 0.04, 0, 1, 0.05, 0.04, 0, 1],
  }
  const result = blobContactMetrics(state, 0.08)
  assert.deepEqual(
    result.labels.map((label) => label.count),
    [1, 1],
  )
  assert.deepEqual(result.nearContactCounts, [1, 1])
  assert.equal(result.minimumCrossLabelDistance, 0.1)
  state.positions[4] = 0.5
  assert.deepEqual(blobContactMetrics(state, 0.08).nearContactCounts, [0, 0])
  console.info(
    'Warm-jelly metric checks passed: original material labels and cross-label separation.',
  )
}

/** Production smoke uses only controls, pointer events and visible canvas state. */
async function verifyProduction(page, context, report) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const canvas = page.getByTestId('gummy-bear-canvas')
  assert.equal(
    await page.evaluate(() => !!window.__gummyParticleStudy),
    false,
    'Production must not expose diagnostic solver access',
  )
  for (const material of ['Elastic jelly', 'Warm jelly'])
    for (const fixture of ['Two blobs', 'Bear']) {
      await button(material).click()
      await button(fixture).click()
      await page.waitForFunction(
        ({ material, fixture }) => {
          const data = document.querySelector(
            '[data-testid="gummy-bear-canvas"]',
          )?.dataset
          return data?.particleMaterial === material && data.fixture === fixture
        },
        {
          material: material === 'Warm jelly' ? 'warm' : 'elastic',
          fixture: fixture === 'Bear' ? 'bear' : 'blobs',
        },
      )
      assert.equal(
        await canvas.count(),
        1,
        'Fixture switches must leave a single owned canvas',
      )
    }
  const pause = async () => {
    if (await button('Pause').count()) await button('Pause').click()
  }
  await pause()
  await button('Reset bear').click()
  await pause()
  await button('Reset view').click()
  await button('Grab & pull').click()
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  assert.ok(box)
  if (process.env.GUMMY_DEBUG_EXCEPTIONS === '1') {
    const debuggerSession = await context.newCDPSession(page)
    report.caughtExceptions = []
    debuggerSession.on('Debugger.paused', async (event) => {
      report.caughtExceptions.push({
        reason: event.reason,
        exception: event.data?.description ?? event.data,
        frames: event.callFrames.slice(0, 6).map((frame) => ({
          name: frame.functionName,
          url: frame.url,
          location: frame.location,
        })),
      })
      await debuggerSession.send('Debugger.resume').catch(() => {})
    })
    await debuggerSession.send('Debugger.enable')
    await debuggerSession.send('Debugger.setPauseOnExceptions', {
      state: 'all',
    })
  }
  const candidates = [
    [0.5, 0.5],
    [0.61, 0.5],
    [0.58, 0.55],
    [0.56, 0.45],
    [0.49, 0.42],
    [0.49, 0.57],
  ]
  report.productionMissedPicks = []
  const expectGrip = async () => {
    try {
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
            .grip === 'true',
        undefined,
        { timeout: 1500 },
      )
      return true
    } catch {
      return false
    }
  }
  let point
  for (const [x, y] of candidates) {
    const candidate = { x: box.x + box.width * x, y: box.y + box.height * y }
    await page.mouse.move(candidate.x, candidate.y)
    await page.mouse.down()
    if (await expectGrip()) {
      point = candidate
      break
    }
    const screenshot = resolve(
      tmpdir(),
      `gummy-production-missed-pick-${report.productionMissedPicks.length}.png`,
    )
    await page.screenshot({ path: screenshot })
    report.productionMissedPicks.push({ ...candidate, box, screenshot })
    await page.mouse.up()
  }
  assert.ok(
    point,
    'Visible material must be reachable through trusted pointer picking',
  )
  assert.equal(
    report.productionMissedPicks.length,
    0,
    'The visible centre of the production bear must be grabbable without a diagnostic-helper failure',
  )
  const before = await canvas.screenshot()
  const initialSteps = Number(await canvas.getAttribute('data-steps'))
  await page.mouse.move(
    point.x + Math.min(60, box.width * 0.15),
    point.y - 10,
    { steps: 12 },
  )
  await canvas.press('Space')
  await page.waitForFunction(
    (ticks) =>
      Number(
        document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
          .steps,
      ) >=
      ticks + 60,
    initialSteps,
  )
  await canvas.press('Space')
  await page.mouse.up()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
        .grip === 'false',
  )
  assert.ok(
    !before.equals(await canvas.screenshot()),
    'Production pointer dragging must change the rendered material',
  )
  await page.screenshot({
    path: resolve(output, 'gummy-warm-production-drag.png'),
  })
  report.productionMouse = true
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await waitForGummyControlsLayout(page)
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }))
    assert.equal(dimensions.viewport, dimensions.content)
    report.layouts.push({ ...viewport, ...dimensions })
  }
  await button('Reset bear').click()
  await pause()
  await canvas.scrollIntoViewIfNeeded()
  const touchBox = await canvas.boundingBox()
  assert.ok(touchBox)
  const cdp = await context.newCDPSession(page)
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 2,
    })
    let center
    for (const [x, y] of candidates) {
      const candidate = {
        x: touchBox.x + touchBox.width * x,
        y: touchBox.y + touchBox.height * y,
        id: 1,
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [candidate],
      })
      if (await expectGrip()) {
        center = candidate
        break
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })
    }
    assert.ok(
      center,
      'Visible material must be reachable through trusted touch picking',
    )
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...center, x: center.x + 20 }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    })
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
          .grip === 'false',
    )
    report.productionTouch = true
  } finally {
    await cdp
      .send('Emulation.setTouchEmulationEnabled', { enabled: false })
      .catch(() => {})
    await cdp.detach()
  }
  for (const model of [
    'Continuous jelly',
    'Fine crush',
    'Limb pull',
    'Particle jelly',
  ]) {
    await button(model).click()
    await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
    assert.equal(
      await canvas.count(),
      1,
      'The preserved comparison models must dispose prior canvases',
    )
  }
  assert.equal(await page.evaluate(() => !!window.__gummyParticleStudy), false)
}

export async function verifyWarmJelly() {
  assert.ok(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0)
  assert.ok(
    Number.isFinite(liveSeconds) && liveSeconds >= 3 && liveSeconds <= 30,
  )
  const { chromium } = createRequire(import.meta.url)('playwright')
  const report = {
    capturedAt: new Date().toISOString(),
    base,
    production,
    sourceHashes: sourceHashes(),
    protocol: {
      outerDt: 1 / 120,
      pullOffsets: [
        [0.3, 0.04, 0],
        [0.6, 0.08, 0],
      ],
      fixedStepTimingIncludesReadback: true,
      liveSeconds,
      video: false,
    },
    samples: [],
    timings: [],
    live: [],
    layouts: [],
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
  const before = desktop()
  const existing = new Set(hypr('clients').map((client) => client.address))
  let browser, page, timer, generation
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
      report.failures.push(
        `Native warm-jelly verification exceeded ${timeoutSeconds}s`,
      )
      void browser.close()
    }, timeoutSeconds * 1000)
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    })
    page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.on('pageerror', (error) => report.errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push(message.text())
      if (message.type() === 'warning') report.warnings.push(message.text())
    })
    await page.goto(`${base}/gummy`, { waitUntil: 'domcontentloaded' })
    report.placement = {
      before,
      after: desktop(),
      clients: hypr('clients')
        .filter((client) => !existing.has(client.address))
        .map((client) => ({
          class: client.class,
          workspace: client.workspace.name,
        })),
    }
    assert.deepEqual(
      report.placement.after,
      before,
      'Verification must leave the foreground desktop unchanged',
    )
    assert.ok(
      report.placement.clients.length > 0 &&
        report.placement.clients.every(
          (client) =>
            client.class === 'agent-browser' &&
            client.workspace === 'special:agents',
        ),
      'Only a hidden agent browser may be used',
    )
    const button = (name) => page.getByRole('button', { name, exact: true })
    await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
    await button('Particle jelly').click()
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="gummy-bear-canvas"]')?.dataset
          .experiment === 'particle',
      undefined,
      { timeout: 60000 },
    )
    report.adapter = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) throw new Error('No WebGPU adapter')
      return {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        description: adapter.info.description,
        fallback:
          adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
      }
    })
    assert.equal(
      report.adapter.fallback,
      false,
      'Native GPU evidence is required',
    )
    if (production) {
      await verifyProduction(page, context, report)
      assert.deepEqual(
        sourceHashes(),
        report.sourceHashes,
        'Source changed during production verification',
      )
      assert.deepEqual(report.errors, [])
      assert.deepEqual(report.warnings, [])
      report.passed = true
      return
    }
    await page.waitForFunction(() => !!window.__gummyParticleStudy, undefined, {
      timeout: 60000,
    })
    const checkGeneration = async () => {
      assert.ok(
        await page.evaluate(
          (expected) => window.__gummyParticleStudy === expected,
          generation,
        ),
        'The scene was replaced during verification; repeat against frozen source',
      )
    }
    let capturedPatch
    const select = async (material, fixture) => {
      capturedPatch = undefined
      await button(material === 'warm' ? 'Warm jelly' : 'Elastic jelly').click()
      await button(fixture === 'bear' ? 'Bear' : 'Two blobs').click()
      await page.waitForFunction(
        ({ material, fixture }) => {
          const info = window.__gummyParticleStudy?.info()
          return (
            info?.settings.particleMaterial === material &&
            info.fixture === fixture
          )
        },
        { material, fixture },
      )
      await button('Reset view').click()
      await button('Grab & pull').click()
      await page.getByLabel('Allow tearing', { exact: true }).check()
      await page.evaluate(() => {
        window.__gummyParticleStudy.resetPaused()
      })
      await generation?.dispose()
      generation = await page.evaluateHandle(() => window.__gummyParticleStudy)
      assert.equal(await page.getByTestId('gummy-bear-canvas').count(), 1)
      await waitForGummyControlsLayout(page)
      await page.getByTestId('gummy-bear-canvas').scrollIntoViewIfNeeded()
    }
    const advance = async (count) => {
      await checkGeneration()
      const started = performance.now()
      for (let tick = 0; tick < count; tick += 20)
        await page.evaluate(
          async (steps) => {
            window.__gummyParticleStudy.advanceFrames(steps)
            await window.__gummyParticleStudy.readState()
          },
          Math.min(20, count - tick),
        )
      report.timings.push({
        steps: count,
        simulationSeconds: count / 120,
        wallSeconds: (performance.now() - started) / 1000,
      })
    }
    const read = () =>
      page.evaluate(async () => {
        const simulation = window.__gummyParticleStudy
        const state = await simulation.readState()
        return {
          info: simulation.info(),
          state: Object.fromEntries(
            Object.entries(state).map(([key, value]) => [
              key,
              ArrayBuffer.isView(value) ? Array.from(value) : value,
            ]),
          ),
        }
      })
    const sample = async (name, screenshot = false) => {
      await checkGeneration()
      const { info, state } = await read()
      const metrics = {
        name,
        info,
        ...analyzeParticleState(state, state.restPositions, info.spacing),
        ...(info.fixture === 'blobs'
          ? { contact: blobContactMetrics(state, info.spacing) }
          : {}),
      }
      const stretch = state.peakStretch.slice().sort((a, b) => a - b)
      metrics.stretchDistribution = Object.fromEntries(
        [0.5, 0.9, 0.99, 1].map((quantile) => [
          `p${quantile * 100}`,
          stretch[
            Math.min(stretch.length - 1, Math.floor(stretch.length * quantile))
          ],
        ]),
      )
      if (capturedPatch)
        metrics.capturedPatch = {
          count: capturedPatch.length,
          maxMovement: Math.max(
            0,
            ...capturedPatch.map(({ index, origin }) =>
              Math.hypot(
                ...origin.map(
                  (value, axis) => state.positions[index + axis] - value,
                ),
              ),
            ),
          ),
        }
      report.samples.push(metrics)
      console.info(
        JSON.stringify({
          name,
          count: metrics.particleCount,
          damage: metrics.meanDamage,
          components: metrics.components.slice(0, 6),
          guards: metrics.guardActivations,
          contactDistance: metrics.contact?.minimumCrossLabelDistance,
        }),
      )
      if (screenshot) {
        await page.evaluate(() => {
          window.__gummyParticleStudy.render()
        })
        await page.screenshot({
          path: resolve(output, `gummy-warm-${name}.png`),
        })
      }
      if (metrics.guardActivations > 0) {
        report.invalidStatePath = resolve(
          tmpdir(),
          'gummy-warm-invalid-state.json',
        )
        writeFileSync(
          report.invalidStatePath,
          `${JSON.stringify({ name, info, state })}\n`,
        )
      }
      assert.ok(metrics.finite, `${name}: all solver state must remain finite`)
      assert.equal(
        metrics.particleCount,
        info.particleCount,
        `${name}: material samples cannot disappear`,
      )
      assert.equal(
        metrics.totalMass,
        info.restVolume,
        `${name}: mass must be preserved`,
      )
      assert.ok(
        metrics.min[1] >= 0,
        `${name}: particles cannot penetrate the floor`,
      )
      assert.ok(
        metrics.pinMovement < 1e-5,
        `${name}: fixed samples cannot move`,
      )
      assert.equal(
        metrics.guardActivations,
        0,
        `${name}: ordinary dragging cannot depend on numerical safeguards`,
      )
      assert.equal(
        metrics.domainContacts,
        0,
        `${name}: dragging must remain within the simulation domain`,
      )
      return metrics
    }
    const project = (point) =>
      page.evaluate(async (point) => {
        const { DEFAULT_GUMMY_ORBIT, gummyCameraMatrices } =
          await import('/src/components/GummyBear/gummyStudyMath.ts')
        const box = document
          .querySelector('[data-testid="gummy-bear-canvas"]')
          .getBoundingClientRect()
        const matrix = new Float32Array(16)
        gummyCameraMatrices(
          DEFAULT_GUMMY_ORBIT,
          box.width / box.height,
          matrix,
          new Float32Array(16),
          new Float32Array(3),
        )
        const homogeneous = [...point, 1]
        const clip = [0, 1, 2, 3].map((row) =>
          homogeneous.reduce(
            (sum, value, column) => sum + matrix[column * 4 + row] * value,
            0,
          ),
        )
        return {
          x: box.x + (box.width * (clip[0] / clip[3] + 1)) / 2,
          y: box.y + (box.height * (1 - clip[1] / clip[3])) / 2,
        }
      }, point)
    const grab = async (point) => {
      const projected = await project(point)
      await page.mouse.move(projected.x, projected.y)
      await page.mouse.down()
      await page.waitForFunction(() => window.__gummyParticleStudy.info().grip)
      const { info, state } = await read()
      const command = info.gripCommand
      const source =
        info.settings.particleMaterial === 'warm'
          ? state.positions
          : state.restPositions
      capturedPatch = []
      for (let index = 0; index < source.length; index += 4) {
        const distance = Math.hypot(
          ...command.center.map((value, axis) => source[index + axis] - value),
        )
        if (state.restPositions[index + 3] > 0 && distance < command.radius)
          capturedPatch.push({
            index,
            origin: state.positions.slice(index, index + 3),
          })
      }
      assert.ok(
        capturedPatch.length > 0,
        'Trusted pointer picking must select an actual material patch',
      )
      return projected
    }
    const release = async () => {
      await page.mouse.up()
      await page.waitForFunction(() => !window.__gummyParticleStudy.info().grip)
    }
    const pull = async (origin, from, to, ticks = 48) => {
      const segments = 12
      for (let index = 1; index <= segments; index++) {
        const point = origin.map(
          (value, axis) =>
            value + from[axis] + ((to[axis] - from[axis]) * index) / segments,
        )
        const target = await project(point)
        await page.mouse.move(target.x, target.y)
        await advance(ticks / segments)
      }
    }
    const bearRuns = {}
    for (const material of ['elastic', 'warm']) {
      await select(material, 'bear')
      if (material === 'warm') {
        await advance(1200)
        const idle = await sample('warm-idle-10s')
        assert.equal(
          idle.damageMax,
          0,
          'An untouched warm bear must not accumulate gravity-induced tearing',
        )
        assert.deepEqual(
          idle.components,
          [idle.particleCount],
          'The untouched warm bear must remain connected for ten seconds',
        )
        await select(material, 'bear')
      }
      await advance(120)
      const settled = await sample(`${material}-settled`, material === 'warm')
      const origin = [0.64, 1.24, 0.08]
      await grab(origin)
      await advance(1)
      await pull(origin, [0, 0, 0], report.protocol.pullOffsets[0])
      const short = await sample(`${material}-short-pull`, true)
      await pull(
        origin,
        report.protocol.pullOffsets[0],
        report.protocol.pullOffsets[1],
      )
      const stretched = await sample(`${material}-extended-pull`)
      await release()
      await advance(180)
      const released = await sample(`${material}-released`, material === 'warm')
      assert.ok(
        short.maxDisplacement > settled.maxDisplacement + 0.05,
        `${material}: a short trusted mouse drag must move material`,
      )
      bearRuns[material] = { settled, short, stretched, released }
      if (material === 'warm' && released.components.length === 1) {
        // Keep this separately labelled; a longer pull cannot stand in for a
        // successful short-drag fracture comparison.
        await select(material, 'bear')
        await advance(120)
        await grab(origin)
        await advance(1)
        await pull(origin, [0, 0, 0], [1.0, 0.1, 0], 96)
        const held = await sample('warm-long-pull', true)
        await release()
        await advance(180)
        const releasedLong = await sample('warm-long-released')
        report.longPull = {
          offset: [1.0, 0.1, 0],
          held,
          released: releasedLong,
        }
      }
    }
    report.comparison = Object.fromEntries(
      ['short', 'stretched', 'released'].map((phase) => [
        phase,
        {
          warmMeanDamage: bearRuns.warm[phase].meanDamage,
          elasticMeanDamage: bearRuns.elastic[phase].meanDamage,
          warmFreeRms: bearRuns.warm[phase].freeDisplacementRms,
          elasticFreeRms: bearRuns.elastic[phase].freeDisplacementRms,
          warmComponents: bearRuns.warm[phase].components,
          elasticComponents: bearRuns.elastic[phase].components,
        },
      ]),
    )
    await select('warm', 'blobs')
    await advance(120)
    const initial = await sample('blobs-settled')
    assert.equal(
      initial.contact.labels[0].count,
      initial.contact.labels[1].count,
      'The contact comparison requires equal initial material volume',
    )
    const pointInLeftMaterial = async (center) => {
      const { state } = await read()
      let closest,
        distance = Infinity
      for (let i = 0; i < state.positions.length; i += 4) {
        if (state.restPositions[i] >= 0) continue
        const candidate = state.positions.slice(i, i + 3)
        const next = Math.hypot(
          ...candidate.map((value, axis) => value - center[axis]),
        )
        if (next < distance) {
          distance = next
          closest = candidate
        }
      }
      assert.ok(closest, 'Original left material must be available to regrab')
      return closest
    }
    let origin = await pointInLeftMaterial(initial.contact.labels[0].centroid)
    await grab(origin)
    await advance(1)
    await pull(origin, [0, 0, 0], [1.6, 0.02, 0], 192)
    await advance(36)
    const pressed = await sample('blobs-pressed', true)
    await release()
    await advance(120)
    const contactReleased = await sample('blobs-released')
    origin = await pointInLeftMaterial(
      contactReleased.contact.labels[0].centroid,
    )
    await grab(origin)
    await advance(1)
    await pull(origin, [0, 0, 0], [-0.8, 0.15, 0], 96)
    const pulled = await sample('blobs-pulled', true)
    await release()
    await advance(120)
    const separated = await sample('blobs-final')
    report.contact = {
      initial: initial.contact,
      pressed: pressed.contact,
      released: contactReleased.contact,
      pulled: pulled.contact,
      final: separated.contact,
      reached:
        pressed.contact.minimumCrossLabelDistance <=
          pressed.contact.contactRadius &&
        pressed.contact.nearContactCounts.every((count) => count > 0),
    }

    // Live wall time is measured separately from deterministic stepping/readbacks.
    for (const material of ['elastic', 'warm']) {
      await select(material, 'bear')
      await advance(120)
      const origin = [0.64, 1.24, 0.08]
      await grab(origin)
      const target = await project([
        origin[0] + 0.3,
        origin[1] + 0.04,
        origin[2],
      ])
      await page.mouse.move(target.x, target.y)
      // Keep the captured mouse down while toggling playback. Clicking a
      // toolbar button would release the very grip this live probe measures.
      await page.getByTestId('gummy-bear-canvas').press('Space')
      const live = await page.evaluate(
        (seconds) =>
          new Promise((resolve) => {
            const sim = window.__gummyParticleStudy
            const startTime = performance.now(),
              startInfo = sim.info(),
              startTick = startInfo.tick
            const intervals = []
            let previous = startTime
            const tick = (now) => {
              intervals.push(now - previous)
              previous = now
              if (now - startTime < seconds * 1000)
                return window.requestAnimationFrame(tick)
              const wallSeconds = (now - startTime) / 1000
              intervals.sort((a, b) => a - b)
              const simulationSeconds = (sim.info().tick - startTick) / 120
              const endInfo = sim.info()
              const completedFrames =
                endInfo.completedFrames - startInfo.completedFrames
              const submittedFrames =
                endInfo.submittedFrames - startInfo.submittedFrames
              resolve({
                wallSeconds,
                simulationSeconds,
                simulationPace: simulationSeconds / wallSeconds,
                submittedFrames,
                completedFrames,
                completedGpuFps: completedFrames / wallSeconds,
                pendingGpuFrames: endInfo.gpuPending,
                frames: intervals.length,
                rafFps: intervals.length / wallSeconds,
                p50FrameMs: intervals[Math.floor(intervals.length * 0.5)],
                p95FrameMs: intervals[Math.floor(intervals.length * 0.95)],
              })
            }
            window.requestAnimationFrame(tick)
          }),
        liveSeconds,
      )
      await page.getByTestId('gummy-bear-canvas').press('Space')
      await release()
      await checkGeneration()
      const drainStarted = performance.now()
      await read()
      const queueDrainWallSeconds = (performance.now() - drainStarted) / 1000
      await sample(`${material}-live-final`)
      report.live.push({
        material,
        ...live,
        includesReadback: false,
        queueDrainWallSeconds,
        completedSimulationPace:
          live.simulationSeconds / (live.wallSeconds + queueDrainWallSeconds),
        frameTimingMeaning:
          'RAF callback cadence is not presented FPS. completedGpuFps counts GPU-completed scene frames.',
      })
      assert.ok(
        live.simulationSeconds > 0,
        `${material}: live simulation must advance`,
      )
      assert.ok(
        Number.isFinite(live.completedGpuFps) && live.completedFrames > 0,
        `${material}: GPU completion must be measured, not only CPU frame submission`,
      )
      assert.ok(
        live.submittedFrames - live.completedFrames <= 1,
        `${material}: live rendering must not build an unbounded GPU queue`,
      )
      console.info(JSON.stringify({ material, ...live }))
    }
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await waitForGummyControlsLayout(page)
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        content: document.documentElement.scrollWidth,
        choices: [...document.querySelectorAll('button')]
          .filter((element) =>
            ['Warm jelly', 'Elastic jelly', 'Bear', 'Two blobs'].includes(
              element.textContent.trim(),
            ),
          )
          .filter((element) => element.getBoundingClientRect().height > 0)
          .map((element) => ({
            name: element.textContent.trim(),
            height: element.getBoundingClientRect().height,
            selected: element.getAttribute('aria-pressed'),
            background: window.getComputedStyle(element).backgroundColor,
          })),
      }))
      assert.equal(
        layout.viewport,
        layout.content,
        'New controls must fit tablet and phone widths',
      )
      assert.equal(
        layout.choices.length,
        4,
        'All new material and fixture choices must be present',
      )
      assert.ok(
        layout.choices.every((choice) => choice.height >= 44),
        'Choices need touch-sized targets',
      )
      const warm = layout.choices.find((choice) => choice.name === 'Warm jelly')
      const elastic = layout.choices.find(
        (choice) => choice.name === 'Elastic jelly',
      )
      assert.equal(warm.selected, 'true')
      assert.equal(elastic.selected, 'false')
      assert.notEqual(
        warm.background,
        elastic.background,
        'The selected material must be visually distinct',
      )
      report.layouts.push({ ...viewport, ...layout })
    }
    await select('warm', 'bear')
    const cdp = await context.newCDPSession(page)
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 2,
      })
      const point = await project([0.64, 1.24, 0.08])
      const dispatchTouch = (type, x = point.x, y = point.y) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: ['touchEnd', 'touchCancel'].includes(type)
            ? []
            : [{ x, y, id: 1 }],
        })
      await page.evaluate(() => {
        window.__gummyWarmTouchEvents = []
        const canvas = document.querySelector(
          '[data-testid="gummy-bear-canvas"]',
        )
        for (const type of ['pointerdown', 'pointerup', 'pointercancel'])
          canvas.addEventListener(type, (event) =>
            window.__gummyWarmTouchEvents.push({
              type,
              pointerType: event.pointerType,
              trusted: event.isTrusted,
            }),
          )
      })
      await dispatchTouch('touchStart')
      await page.waitForFunction(() => window.__gummyParticleStudy.info().grip)
      const beforeTouch = (await read()).state.positions
      await advance(1)
      for (let step = 1; step <= 8; step++) {
        await dispatchTouch('touchMove', point.x + step * 4, point.y - step)
        await advance(4)
      }
      const afterTouch = (await read()).state.positions
      await dispatchTouch('touchEnd')
      await page.waitForFunction(() => !window.__gummyParticleStudy.info().grip)
      const displacement = Math.max(
        ...beforeTouch.map((value, index) =>
          index % 4 === 3 ? 0 : Math.abs(value - afterTouch[index]),
        ),
      )
      assert.ok(
        displacement > 0.03,
        'A real touch drag must move warm material',
      )
      await page.evaluate(() => {
        window.__gummyParticleStudy.resetPaused()
      })
      await dispatchTouch('touchStart')
      await page.waitForFunction(() => window.__gummyParticleStudy.info().grip)
      await dispatchTouch('touchCancel')
      await page.waitForFunction(() => !window.__gummyParticleStudy.info().grip)
      const events = await page.evaluate(() => window.__gummyWarmTouchEvents)
      for (const type of ['pointerdown', 'pointerup', 'pointercancel'])
        assert.ok(
          events.some(
            (event) =>
              event.type === type &&
              event.pointerType === 'touch' &&
              event.trusted,
          ),
          `${type} must use the real browser touch path`,
        )
      report.touch = { displacement, events }
    } finally {
      await cdp
        .send('Emulation.setTouchEmulationEnabled', { enabled: false })
        .catch(() => {})
      await cdp.detach()
    }
    assert.deepEqual(
      sourceHashes(),
      report.sourceHashes,
      'Source changed during native verification',
    )
    assert.deepEqual(
      report.errors,
      [],
      'The preview must have no browser errors',
    )
    assert.deepEqual(
      report.warnings,
      [],
      'The preview must have no browser warnings',
    )
    report.stabilityAndInputsPassed = true
    assert.ok(
      report.contact.reached,
      'The pressing interaction must bring the two labelled materials into geometric contact; stability and input checks completed independently',
    )
    report.passed = true
  } catch (error) {
    report.failures.push(String(error))
    throw error
  } finally {
    clearTimeout(timer)
    report.finalSourceHashes = sourceHashes()
    report.sourceStable =
      JSON.stringify(report.sourceHashes) ===
      JSON.stringify(report.finalSourceHashes)
    await generation?.dispose().catch(() => {})
    await browser?.close()
    const path = resolve(
      output,
      `gummy-warm-${production ? 'production-' : ''}verification.json`,
    )
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
    console.info(`Warm-jelly report: ${path}`)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes('--self-test')) selfTest()
  else await verifyWarmJelly()
}
