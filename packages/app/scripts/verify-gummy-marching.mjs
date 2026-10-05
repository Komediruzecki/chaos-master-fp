/** Native GPU marching-cubes comparison: trusted drag, bounded meshes, floor light and reachable touch controls. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { waitForGummyControlsLayout } from './gummy-study-input-checks.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
const production = process.env.GUMMY_PRODUCTION === '1'
const strongTear = process.env.GUMMY_STRONG_TEAR === '1'
const skipLive = process.env.GUMMY_SKIP_LIVE === '1'
const output = resolve(
  process.env.GUMMY_MARCHING_OUTPUT ?? '/tmp/gummy-marching',
)
const timeoutSeconds = Number(process.env.GUMMY_MARCHING_TIMEOUT ?? 240)
assert.ok(
  Number.isFinite(timeoutSeconds) &&
    timeoutSeconds > 0 &&
    timeoutSeconds <= 300,
)
const hash = (data) => createHash('sha256').update(data).digest('hex')
const sourceHashes = () =>
  Object.fromEntries(
    ['simulation/gummy', 'components/GummyBear', 'pages/GummyBear'].flatMap(
      (directory) =>
        readdirSync(resolve(repo, 'packages/app/src', directory))
          .filter(
            (file) => /\.(tsx?|css)$/.test(file) && !file.includes('.test.'),
          )
          .sort()
          .map((file) => [
            `${directory}/${file}`,
            hash(
              readFileSync(resolve(repo, 'packages/app/src', directory, file)),
            ),
          ]),
    ),
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
const report = {
  capturedAt: new Date().toISOString(),
  base,
  production,
  sourceHashes: sourceHashes(),
  samples: [],
  live: [],
  layouts: [],
  errors: [],
  warnings: [],
  failures: [],
  screenshots: [],
  protocol: {
    liveSeconds: skipLive ? 0 : 3,
    liveUsesReadback: false,
    strongTear,
    video: false,
  },
}
mkdirSync(output, { recursive: true })
const before = desktop(),
  clientsBefore = new Set(hypr('clients').map((client) => client.address))
let browser, timer

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
    report.failures.push(
      `Marching-cubes verification exceeded ${timeoutSeconds}s`,
    )
    void browser.close()
  }, timeoutSeconds * 1000)
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
    if (message.type() === 'warning') report.warnings.push(message.text())
  })
  await page.goto(`${base}/gummy?experiment=mpm`, {
    waitUntil: 'domcontentloaded',
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
  assert.deepEqual(
    report.placement.after,
    before,
    'The hidden browser must not take focus',
  )
  assert.ok(
    report.placement.clients.length > 0 &&
      report.placement.clients.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace === 'special:agents',
      ),
  )
  const button = (name) => page.getByRole('button', { name, exact: true })
  const canvas = page.getByTestId('gummy-bear-canvas')
  const ready = async (experiment = 'mpm') => {
    await page.waitForFunction(
      (expected) => {
        const canvas = document.querySelector(
          '[data-testid="gummy-bear-canvas"]',
        )
        return (
          document.querySelector('[data-ready="true"]') &&
          canvas?.dataset.experiment === expected
        )
      },
      experiment,
      { timeout: 60000 },
    )
    assert.equal(
      await canvas.count(),
      1,
      'Changing models must dispose the previous canvas',
    )
  }
  const pause = async () => {
    if (await button('Pause').count()) await button('Pause').click()
  }
  const snapshot = async (name) => {
    await canvas.scrollIntoViewIfNeeded()
    const path = resolve(
      output,
      `gummy-marching-${production ? 'production-' : ''}${name}.png`,
    )
    const data = await canvas.screenshot({ path })
    report.screenshots.push({ name, path, sha256: hash(data) })
    return data
  }
  await ready()
  assert.equal(
    await canvas.getAttribute('data-reconstruction'),
    'marching-cubes',
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
    'Verification requires hardware WebGPU',
  )
  await button('Warm jelly').click()
  await button('Bear').click()
  await ready()
  await pause()
  await button('Reset bear').click()
  await pause()
  await button('Reset view').click()
  await button('Grab & pull').click()
  await page.getByLabel('Allow tearing', { exact: true }).check()
  await page.getByRole('radio', { name: 'Marble', exact: true }).check()
  await canvas.scrollIntoViewIfNeeded()
  await page.evaluate(() => {
    window.__gummyMarchingInputs = []
    document.addEventListener(
      'pointerdown',
      (event) =>
        window.__gummyMarchingInputs.push({
          type: event.type,
          trusted: event.isTrusted,
          target: event.target.tagName,
          pointerType: event.pointerType,
        }),
      { passive: true },
    )
    document.addEventListener(
      'pointerup',
      (event) =>
        window.__gummyMarchingInputs.push({
          type: event.type,
          trusted: event.isTrusted,
          target: event.target.tagName,
          pointerType: event.pointerType,
        }),
      { passive: true },
    )
  })
  const grip = (expected) =>
    page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
          .grip === String(expected),
      expected,
    )
  const advance = async (count) => {
    for (let step = 0; step < count; step += 12)
      await page.evaluate(
        async (count) => {
          window.__gummyParticleStudy.advanceFrames(count)
          await window.__gummyParticleStudy.readState()
        },
        Math.min(12, count - step),
      )
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
  // Compact supports farther apart than this cannot exchange reconstructed density.
  // Adding a cell diagonal also rules out interpolation joining their cube cells.
  const components = (positions, distance) => {
    const parents = Array.from(
      { length: positions.length / 4 },
      (_, index) => index,
    )
    const find = (index) => {
      while (parents[index] !== index) {
        parents[index] = parents[parents[index]]
        index = parents[index]
      }
      return index
    }
    const distanceSquared = distance ** 2
    for (let a = 0; a < parents.length; a++) {
      for (let b = a + 1; b < parents.length; b++) {
        const dx = positions[a * 4] - positions[b * 4]
        const dy = positions[a * 4 + 1] - positions[b * 4 + 1]
        const dz = positions[a * 4 + 2] - positions[b * 4 + 2]
        if (dx * dx + dy * dy + dz * dz <= distanceSquared)
          parents[find(a)] = find(b)
      }
    }
    const sizes = new Map()
    for (let index = 0; index < parents.length; index++) {
      const root = find(index)
      sizes.set(root, (sizes.get(root) ?? 0) + 1)
    }
    return [...sizes.values()].sort((a, b) => b - a)
  }
  const sample = async (name, allowDomainContact = false) => {
    const data = await page.evaluate(async () => {
      const study = window.__gummyParticleStudy
      const state = await study.readState()
      return {
        info: study.info(),
        surface: await study.readSurfaceStats(),
        positions: Array.from(state.positions),
        finite: [
          state.positions,
          state.velocities,
          state.deformation,
          state.damage,
        ].every((values) => Array.from(values).every(Number.isFinite)),
        guards: state.guardActivations,
        mass: state.totalMass,
        domainContacts: state.domainContacts,
      }
    })
    assert.equal(
      data.finite,
      true,
      `${name}: all material state must be finite`,
    )
    assert.ok(
      data.surface.vertexCount > 0 && data.surface.vertexCount % 3 === 0,
      `${name}: surface must contain complete triangles`,
    )
    assert.equal(
      data.surface.overflow,
      false,
      `${name}: mesh capacity cannot overflow`,
    )
    assert.equal(
      data.mass,
      data.info.restVolume,
      `${name}: material mass cannot disappear`,
    )
    data.positionBounds = {
      min: [0, 1, 2].map((axis) =>
        Math.min(...data.positions.filter((_, index) => index % 4 === axis)),
      ),
      max: [0, 1, 2].map((axis) =>
        Math.max(...data.positions.filter((_, index) => index % 4 === axis)),
      ),
    }
    report.samples.push({ name, ...data, positions: undefined })
    assert.ok(
      data.positionBounds.min.every(
        (value, axis) => value >= data.info.gridBounds.min[axis] - 0.00001,
      ) &&
        data.positionBounds.max.every(
          (value, axis) => value <= data.info.gridBounds.max[axis] + 0.00001,
        ),
      `${name}: particle positions must remain bounded by the solver domain`,
    )
    if (!allowDomainContact)
      assert.equal(
        data.domainContacts,
        0,
        `${name}: this drag must not contact the domain walls`,
      )
    if (name.startsWith('strong-'))
      assert.equal(
        data.guards,
        0,
        `${name}: deliberate wall contact must not invoke numerical guards`,
      )
    console.info(
      JSON.stringify({
        sample: name,
        vertices: data.surface.vertexCount,
        guards: data.guards,
        finite: data.finite,
      }),
    )
    return data
  }
  await snapshot('rest-marble')
  if (production) {
    assert.equal(
      await page.evaluate(() => !!window.__gummyParticleStudy),
      false,
      'Production must not expose diagnostics',
    )
    const box = await canvas.boundingBox()
    const point = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 }
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await grip(true)
    const initial = Number(await canvas.getAttribute('data-steps'))
    await page.mouse.move(point.x + 75, point.y - 12, { steps: 12 })
    await canvas.press('Space')
    await page.waitForFunction(
      (initial) =>
        Number(
          document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
            .steps,
        ) >=
        initial + 48,
      initial,
    )
    await canvas.press('Space')
    await snapshot('held')
    await page.mouse.up()
    await grip(false)
    await canvas.press('Space')
    await page.waitForTimeout(700)
    await canvas.press('Space')
    const released = await snapshot('released')
    assert.notEqual(
      hash(released),
      report.screenshots[0].sha256,
      'Trusted production drag must deform visible material',
    )
    report.productionDrag = true
  } else {
    await page.waitForFunction(
      () => !!window.__gummyParticleStudy?.readSurfaceStats,
    )
    const rest = await sample('rest')
    const origin = [0.64, 1.24, 0.08],
      point = await project(origin)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await grip(true)
    for (let step = 1; step <= 12; step++) {
      const target = await project([
        origin[0] + (0.7 * step) / 12,
        origin[1] + (0.08 * step) / 12,
        origin[2],
      ])
      await page.mouse.move(target.x, target.y)
      await advance(6)
    }
    const held = await sample('held')
    const moved = Math.max(
      ...held.positions.map((value, index) =>
        index % 4 === 3 ? 0 : Math.abs(value - rest.positions[index]),
      ),
    )
    assert.ok(
      moved > 0.05,
      'A trusted drag must move actual material particles',
    )
    report.dragDisplacement = moved
    await snapshot('held')
    await page.mouse.up()
    await grip(false)
    await advance(96)
    await sample('released')
    await snapshot('released')
  }
  report.inputs = await page.evaluate(() => window.__gummyMarchingInputs)
  assert.ok(
    report.inputs.some(
      (event) =>
        event.target === 'CANVAS' &&
        event.type === 'pointerdown' &&
        event.trusted,
    ),
  )
  assert.ok(
    report.inputs.some(
      (event) =>
        event.target === 'CANVAS' &&
        event.type === 'pointerup' &&
        event.trusted,
    ),
  )

  // Same camera, geometry and paused simulation: only the floor-light checkbox changes.
  const time = await canvas.getAttribute('data-sim-time')
  await page.getByLabel('Floor caustics', { exact: true }).uncheck()
  const unlit = await snapshot('caustics-off')
  await page.getByLabel('Floor caustics', { exact: true }).check()
  const lit = await snapshot('caustics-on')
  assert.equal(await canvas.getAttribute('data-sim-time'), time)
  assert.ok(
    !unlit.equals(lit),
    'Caustic light must visibly change the same paused state',
  )
  report.caustics = {
    sameSimulationTime: time,
    off: hash(unlit),
    on: hash(lit),
  }
  await page.getByRole('radio', { name: 'Blue', exact: true }).check()
  assert.ok(
    !lit.equals(await snapshot('released-blue')),
    'Palette selection must affect the reconstructed material',
  )
  await page.getByRole('radio', { name: 'Marble', exact: true }).check()

  if (strongTear && !production) {
    await button('Reset bear').click()
    await pause()
    await button('Reset view').click()
    await canvas.scrollIntoViewIfNeeded()
    const rest = await sample('strong-rest')
    const supportScale = await page.evaluate(async () => {
      const { MARCHING_GUMMY_RADIUS_SCALE } =
        await import('/src/components/GummyBear/marchingGummyMath.ts')
      return MARCHING_GUMMY_RADIUS_SCALE
    })
    const supportDiameter = 2 * rest.info.spacing * supportScale
    const conservativeDistance =
      supportDiameter + Math.sqrt(3) * rest.surface.cellSize
    report.strongTear = {
      travel: 2,
      supportDiameter,
      conservativeDistance,
      samples: [],
    }
    const recordTopology = (sample) => {
      const topology = {
        time: sample.info.time,
        supportComponents: components(sample.positions, supportDiameter),
        conservativeComponents: components(
          sample.positions,
          conservativeDistance,
        ),
      }
      report.strongTear.samples.push(topology)
      return topology
    }
    assert.equal(recordTopology(rest).conservativeComponents.length, 1)
    const origin = [0.64, 1.24, 0.08],
      point = await project(origin)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await grip(true)
    for (let step = 1; step <= 24; step++) {
      const target = await project([
        origin[0] + (2 * step) / 24,
        origin[1] + (0.25 * step) / 24,
        origin[2],
      ])
      await page.mouse.move(target.x, target.y)
      await advance(6)
    }
    const held = recordTopology(await sample('strong-held'))
    await snapshot('strong-held')
    await page.mouse.up()
    await grip(false)
    // Inspect fresh detached material, then retain the longer finite-domain wall-contact case.
    await advance(48)
    const released = recordTopology(await sample('strong-released'))
    await snapshot('strong-released')
    await advance(96)
    recordTopology(await sample('strong-long-release', true))
    await snapshot('strong-long-release')
    report.strongTear.detached =
      Math.max(
        held.conservativeComponents.length,
        released.conservativeComponents.length,
      ) > 1
    report.strongTear.inputs = await page.evaluate(
      () => window.__gummyMarchingInputs,
    )
    assert.equal(
      report.strongTear.detached,
      true,
      'Strong trusted drag must detach compact particle density supports',
    )
  }

  if (!production && !skipLive) {
    for (const [label, experiment] of [
      ['MPM + marching cubes', 'mpm'],
      ['Particle jelly', 'particle'],
    ]) {
      await button(label).click()
      await ready(experiment)
      await pause()
      await button('Reset bear').click()
      await pause()
      await canvas.scrollIntoViewIfNeeded()
      await button('Resume').click()
      const start = await page.evaluate(() => ({
        wall: window.performance.now(),
        ...window.__gummyParticleStudy.info(),
      }))
      await page.waitForTimeout(3000)
      const end = await page.evaluate(() => ({
        wall: window.performance.now(),
        ...window.__gummyParticleStudy.info(),
      }))
      await pause()
      const seconds = (end.wall - start.wall) / 1000
      const completed = end.completedFrames - start.completedFrames
      assert.ok(
        completed > 0 && end.time > start.time,
        `${label}: playback must progress`,
      )
      report.live.push({
        experiment,
        seconds,
        completedFrames: completed,
        fps: completed / seconds,
        simulationSeconds: end.time - start.time,
        canvas: await canvas.boundingBox(),
        readbacksDuringWindow: false,
      })
    }
  }
  await button('MPM + marching cubes').click()
  await ready()
  for (const [name, expected] of [
    ['Two blobs', 'blobs'],
    ['Bear', 'bear'],
  ]) {
    await button(name).click()
    await ready()
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
          .fixture === expected,
      expected,
    )
  }
  for (const [name, expected] of [
    ['Elastic jelly', 'elastic'],
    ['Warm jelly', 'warm'],
  ]) {
    await button(name).click()
    await ready()
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
          .particleMaterial === expected,
      expected,
    )
  }
  for (const [name, experiment] of [
    ['Continuous jelly', 'jelly'],
    ['Fine crush', 'crush'],
    ['Limb pull', 'pull'],
    ['MPM + marching cubes', 'mpm'],
  ]) {
    await button(name).click()
    await ready(experiment)
  }

  // Reload at each responsive size so lower controls begin genuinely off screen.
  const cdp = await context.newCDPSession(page)
  try {
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 1,
      })
      await page.goto(`${base}/gummy?experiment=mpm`, {
        waitUntil: 'domcontentloaded',
      })
      await ready()
      await waitForGummyControlsLayout(page)
      const target = () =>
        page.evaluate(() => {
          const aside = document.querySelector(
            'aside[aria-label="Gummy controls"]',
          )
          const button = [...aside.querySelectorAll('button')].at(-1)
          const rect = button.getBoundingClientRect(),
            x = rect.x + rect.width / 2,
            y = rect.y + rect.height / 2
          const hit = document.elementFromPoint(x, y)
          return {
            x,
            y,
            text: button.textContent.trim(),
            selected: button.getAttribute('aria-pressed'),
            reachable:
              rect.top >= 0 &&
              rect.bottom <= window.innerHeight &&
              !!hit &&
              (hit === button || button.contains(hit)),
            scrollTop: document.querySelector('main').scrollTop,
            width: window.innerWidth,
            contentWidth: document.documentElement.scrollWidth,
          }
        })
      const entry = {
        ...viewport,
        initial: await target(),
        origins: [],
        gestures: 0,
      }
      report.layouts.push(entry)
      assert.equal(entry.initial.reachable, false)
      for (
        let attempt = 0;
        attempt < 18 && !(await target()).reachable;
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
          ) {
            for (const fraction of [0.5, 0.25, 0.75]) {
              const x = rect.x + rect.width * fraction,
                hit = document.elementFromPoint(x, y)
              const end = Math.max(
                16,
                rect.top + 8,
                y - window.innerHeight * 0.48,
              )
              if (
                hit &&
                aside.contains(hit) &&
                !hit.closest('button,input,select,textarea') &&
                y - end >= 96
              )
                return { x, start: y, end, source: 'controls' }
            }
          }
          const surfaces = [...document.querySelectorAll('main p,main span')]
            .filter((element) => !element.closest('aside,button,input,a'))
            .map((element) => ({
              element,
              rect: element.getBoundingClientRect(),
            }))
            .filter(
              ({ rect }) =>
                rect.top > 30 && rect.bottom < window.innerHeight - 6,
            )
            .sort((a, b) => b.rect.bottom - a.rect.bottom)
          for (const { element, rect } of surfaces) {
            const x = rect.x + rect.width / 2,
              start = rect.y + rect.height / 2,
              hit = document.elementFromPoint(x, start),
              end = Math.max(12, start - window.innerHeight * 0.48)
            if (
              hit &&
              (hit === element || element.contains(hit)) &&
              start - end >= 50
            )
              return { x, start, end, source: 'page-text' }
          }
          return {
            x: 7,
            start: window.innerHeight * 0.8,
            end: window.innerHeight * 0.25,
            source: 'gutter',
          }
        })
        entry.origins.push(origin)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: origin.x, y: origin.start, id: 1 }],
        })
        for (let step = 1; step <= 8; step++) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              {
                x: origin.x,
                y: origin.start + ((origin.end - origin.start) * step) / 8,
                id: 1,
              },
            ],
          })
          await page.waitForTimeout(20)
        }
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        })
        await page.waitForTimeout(80)
        entry.gestures++
      }
      entry.final = await target()
      assert.equal(entry.final.text, 'Limb pull')
      assert.equal(entry.final.selected, 'false')
      assert.equal(
        entry.final.reachable,
        true,
        'Native touch swipes must reveal the bottom control',
      )
      assert.equal(entry.final.width, entry.final.contentWidth)
      assert.ok(entry.origins.some((origin) => origin.source === 'controls'))
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: entry.final.x, y: entry.final.y, id: 1 }],
      })
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })
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
            .experiment === 'pull' &&
          document.querySelector('[data-ready="true"]'),
      )
      entry.tappedBottomControl = true
      await page.screenshot({
        path: resolve(
          output,
          `gummy-marching-${production ? 'production-' : ''}controls-${viewport.width}.png`,
        ),
      })
    }
  } finally {
    await cdp
      .send('Emulation.setTouchEmulationEnabled', { enabled: false })
      .catch(() => {})
    await cdp.detach()
  }
  assert.deepEqual(
    sourceHashes(),
    report.sourceHashes,
    'Source must stay frozen during verification',
  )
  assert.deepEqual(report.errors, [], 'No page or WebGPU errors are acceptable')
  assert.deepEqual(
    report.warnings,
    [],
    'No WebGPU or app warnings are acceptable',
  )
  report.passed = true
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  clearTimeout(timer)
  await browser?.close()
  report.finalDesktop = desktop()
  report.finalSourceHashes = sourceHashes()
  report.sourceStable =
    JSON.stringify(report.sourceHashes) ===
    JSON.stringify(report.finalSourceHashes)
  const path = resolve(
    output,
    `gummy-marching-${production ? 'production-' : ''}verification.json`,
  )
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  console.info(`Marching-cubes report: ${path}`)
}
