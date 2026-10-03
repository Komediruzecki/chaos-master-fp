/** Native-GPU compression controls, fragment measurements and hidden-desktop captures. */
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
const rawOutput =
  process.env.GUMMY_RAW === '1'
    ? mkdtempSync(resolve(tmpdir(), 'gummy-calibration-'))
    : undefined
const movie =
  process.env.GUMMY_VIDEO === '1'
    ? mkdtempSync(resolve(tmpdir(), 'gummy-frames-'))
    : undefined
let movieFrame = 0
const report = { base, samples: [], errors: [], failures: [], timings: [] }
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
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  page.setDefaultTimeout(30000)
  await page.goto(`${base}/gummy`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-ready="true"]', { timeout: 60000 })
  await page.waitForFunction(() => !!window.__gummyStudy)
  await page.getByRole('button', { name: 'Fine crush', exact: true }).click()
  await page.waitForFunction(
    () => window.__gummyStudy?.info().experiment === 'crush',
  )
  let generation = await page.evaluateHandle(() => window.__gummyStudy)
  const ensureGeneration = async () => {
    if (!(await generation.evaluate((study) => study === window.__gummyStudy)))
      throw new Error(
        'The scene changed during capture; stop source edits and rerun',
      )
  }
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
    return {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      fallback: adapter.isFallbackAdapter,
    }
  })
  const click = (name) =>
    page.getByRole('button', { name, exact: true }).click()
  const freeze = async () => {
    if (await page.getByRole('button', { name: 'Pause', exact: true }).count())
      await click('Pause')
  }
  const reset = async () => {
    await click('Reset bear')
    await freeze()
  }
  const advance = async (count, record = false) => {
    const started = performance.now()
    const batch = record && movie ? 4 : 30
    for (let i = 0; i < count; i += batch) {
      await ensureGeneration()
      await page.evaluate(
        async (steps) => {
          window.__gummyStudy.advanceFrames(steps)
          await window.__gummyStudy.readState()
        },
        Math.min(batch, count - i),
      )
      if (record && movie) {
        // Read in the same browser task as rendering, before WebGPU presents
        // and expires the canvas texture. Locator screenshots wait for layout
        // stability and are prohibitively slow for this frame sequence.
        const png = await page.evaluate(() => {
          window.__gummyStudy.render()
          const canvas = /** @type {HTMLCanvasElement} */ (
            document.querySelector('[data-testid="gummy-bear-canvas"]')
          )
          return canvas.toDataURL('image/png').split(',')[1]
        })
        if (!png) throw new Error('The renderer returned an empty video frame')
        writeFileSync(
          resolve(movie, `${String(movieFrame++).padStart(4, '0')}.png`),
          Buffer.from(png, 'base64'),
        )
      }
    }
    report.timings.push({
      steps: count,
      simulationSeconds: count / 120,
      wallSeconds: (performance.now() - started) / 1000,
      includesFrameCapture: !!(record && movie),
    })
  }
  const sample = async (name) => {
    await ensureGeneration()
    if (rawOutput) {
      const raw = await page.evaluate(async () => {
        const state = await window.__gummyStudy.readState()
        return {
          ...window.__gummyStudy.info(),
          positions: Array.from(state.positions),
          damage: Array.from(state.damage),
          forces: Array.from(state.cohesiveForces),
        }
      })
      writeFileSync(resolve(rawOutput, `${name}.json`), JSON.stringify(raw))
      console.log(`Raw calibration: ${resolve(rawOutput, `${name}.json`)}`)
    }
    const result = await page.evaluate(async (name) => {
      const sim = window.__gummyStudy
      sim.render()
      const state = await sim.readState()
      const info = sim.info()
      const { buildGummyBearMesh, tetrahedronVolume } =
        await import('/src/simulation/gummy/gummyMesh.ts')
      const mesh = buildGummyBearMesh(
        info.experiment === 'crush'
          ? { fracture: 'fine', pinnedFeet: false }
          : {},
      )
      const { prepareGummyPatches, GUMMY_PATCH_FAILED_AREA_FRACTION } =
        await import('/src/simulation/gummy/gummyPatches.ts')
      const patches = prepareGummyPatches(mesh)
      const headers = new Uint32Array(patches.patches),
        headerAreas = new Float32Array(patches.patches)
      const faces = new Uint32Array(patches.faces),
        areas = new Float32Array(patches.faces)
      let incompleteFailedPatches = 0
      for (let patch = 0; patch < patches.count; patch++) {
        let failedArea = 0,
          intactFaces = 0
        const offset = headers[patch * 4],
          count = headers[patch * 4 + 1]
        for (let i = offset; i < offset + count; i++) {
          if (state.damage[faces[i * 2]] >= 1) failedArea += areas[i * 2 + 1]
          else intactFaces++
        }
        if (
          intactFaces &&
          failedArea >
            headerAreas[patch * 4 + 2] * GUMMY_PATCH_FAILED_AREA_FRACTION + 1e-8
        )
          incompleteFailedPatches++
      }
      const p = state.positions
      const point = (id) => [p[id * 4], p[id * 4 + 1], p[id * 4 + 2]]
      let volume = 0,
        invertedVolume = 0,
        inverted = 0,
        floorPenetration = 0,
        platePenetration = 0
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < p.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[i + k])
          max[k] = Math.max(max[k], p[i + k])
        }
        floorPenetration = Math.max(floorPenetration, -Number(p[i + 1]))
        if (
          info.press &&
          Math.abs(p[i]) <= info.press.halfExtent &&
          Math.abs(p[i + 2]) <= info.press.halfExtent
        )
          platePenetration = Math.max(
            platePenetration,
            p[i + 1] - info.press.height,
          )
      }
      for (let i = 0; i < mesh.tetrahedra.length; i += 4) {
        const v = tetrahedronVolume(
          ...Array.from(mesh.tetrahedra.slice(i, i + 4), point),
        )
        volume += v
        if (v < 0) {
          inverted++
          invertedVolume -= v
        }
      }
      const componentLabels = state.contactComponents
        ? state.fragments.components.map(
            (component) =>
              new Set(
                component.regions.map(
                  (region) => state.contactComponents[region],
                ),
              ),
          )
        : undefined
      return {
        name,
        ...info,
        finite: [...p, ...state.damage].every(Number.isFinite),
        min,
        max,
        volumeRatio: volume / mesh.restVolume,
        inverted,
        invertedVolumeFraction: invertedVolume / mesh.restVolume,
        floorPenetration,
        platePenetration,
        broken: state.damage.filter((value) => value >= 1).length,
        maxDamage: Math.max(0, ...state.damage),
        maxCohesiveForce: state.maxCohesiveForce,
        incompleteFailedPatches,
        contactGraphMatches: componentLabels
          ? componentLabels.every((labels) => labels.size === 1) &&
            new Set(componentLabels.map((labels) => [...labels][0])).size ===
              componentLabels.length
          : undefined,
        connectedParts: state.fragments.connectedParts,
        largestComponentVolumeFraction:
          state.fragments.largestComponentVolumeFraction,
        components: state.fragments.components.map(
          ({ restVolume, volumeFraction, tetrahedronCount }) => ({
            restVolume,
            volumeFraction,
            tetrahedronCount,
          }),
        ),
      }
    }, name)
    report.samples.push(result)
    const { components: _components, ...compact } = result
    console.log(JSON.stringify(compact))
    await page.screenshot({
      path: resolve(output, `gummy-fracture-${name}.png`),
    })
    if (!result.finite) throw new Error(`Nonfinite state: ${name}`)
    if (result.contactGraphMatches === false)
      throw new Error(
        `GPU contact components disagree with tetrahedral connectivity: ${name}`,
      )
    if (result.experiment === 'crush' && result.incompleteFailedPatches)
      throw new Error(
        `Failed seam patches still have residual connections: ${name}`,
      )
    return result
  }
  await reset()
  await sample('intact')
  if (!quick) {
    await advance(1200)
    const idle = await sample('idle')
    if (idle.broken !== 0)
      report.failures.push('Idle gravity fractured the bear')
  }
  await click('Demo crush')
  await freeze()
  let current = 0
  for (const [target, name] of [
    [360, 'compression'],
    [780, 'crushed'],
    [1020, 'released'],
    [1380, 'settled'],
  ]) {
    await advance(target - current, true)
    current = target
    const state = await sample(name)
    if (name === 'settled') {
      if (
        state.connectedParts < 20 ||
        state.largestComponentVolumeFraction > 0.5
      )
        report.failures.push(
          'Crush must release many volumetric parts, without leaving most of the bear connected',
        )
      if (Math.abs(state.volumeRatio - 1) > 0.03)
        report.failures.push(
          'Released fragments did not recover their volume within 3%',
        )
    }
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
        resolve(output, 'gummy-fracture-demo.mp4'),
      ],
      { timeout: 60000 },
    )
  if (!quick) {
    await page.getByLabel('Allow tearing', { exact: true }).uncheck()
    await click('Replay crush')
    await freeze()
    await advance(1380)
    const elastic = await sample('tearing-disabled')
    if (elastic.broken !== 0 || elastic.connectedParts !== 1)
      report.failures.push('Tearing-disabled control fractured')
    await page.getByLabel('Allow tearing', { exact: true }).check()
    await click('Limb pull')
    await page.waitForFunction(
      () => window.__gummyStudy?.info().experiment === 'pull',
    )
    await generation.dispose()
    generation = await page.evaluateHandle(() => window.__gummyStudy)
    await reset()
    await click('Demo pull')
    await freeze()
    await advance(600)
    const limb = await sample('original-pull')
    if (limb.connectedParts < 2)
      report.failures.push('Original pull no longer tears')
    await click('Fine crush')
    await page.waitForFunction(
      () => window.__gummyStudy?.info().experiment === 'crush',
    )
    await generation.dispose()
    generation = await page.evaluateHandle(() => window.__gummyStudy)
    await reset()
    await click('Grab & pull')
    report.inputs = await checkGummyInputs(page, context)
    await click('Orbit')
    for (const [width, height, name] of [
      [1024, 768, 'tablet'],
      [390, 844, 'phone'],
    ]) {
      await page.setViewportSize({ width, height })
      await waitForGummyControlsLayout(page)
      await page.evaluate(() => {
        window.__gummyStudy.render()
      })
      report[name] = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      }))
      await page.screenshot({
        path: resolve(output, `gummy-fracture-${name}.png`),
        fullPage: true,
      })
      if (report[name].document > width) throw new Error(`${name} overflow`)
    }
  }
  if (report.errors.length)
    throw new Error(`Browser reported ${report.errors.length} errors`)
  if (report.failures.length) throw new Error(report.failures.join('; '))
} catch (error) {
  report.failures.push(String(error))
  throw error
} finally {
  writeFileSync(
    resolve(output, 'gummy-fracture-verification.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await browser?.close()
  if (movie) rmSync(movie, { recursive: true, force: true })
}
