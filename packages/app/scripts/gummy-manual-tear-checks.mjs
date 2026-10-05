/** Real pointer, short-drag fracture checks. No scripted pull or video generation. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { analyzeRuntimeJelly } from './gummy-jelly-topology-checks.mjs'
import { checkGummyRoundedSurface } from './gummy-rounded-surface-checks.mjs'
import { gummyArmPoint } from './gummy-study-input-checks.mjs'

export async function checkGummyManualTearing(
  page,
  context,
  output,
  production,
  report,
) {
  const soft = report.tearResponse === 'soft'
  const prefix = report.capturePrefix ?? (soft ? 'gummy-soft' : 'gummy-hot')
  const result = Object.assign(report, { manualSamples: [], shortDrags: [] })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const canvas = page.getByTestId('gummy-bear-canvas')
  const tearing = page.getByRole('checkbox', { name: 'Allow tearing' })
  const fragility = page.getByRole('slider', { name: /Fragility/ })
  const screenshot = (name) =>
    page.screenshot({
      path: resolve(output, `${prefix}-${name}.png`),
      fullPage: true,
    })
  const check = (condition, message) => {
    if (!condition) result.failures.push(message)
  }
  const setFragility = (value) => fragility.fill(String(value))
  const freeze = async () => {
    if (await button('Pause').count()) await button('Pause').click()
  }
  const reset = async () => {
    await button('Reset bear').click()
    if (!production) await freeze()
    await button('Reset view').click()
    await canvas.scrollIntoViewIfNeeded()
  }
  const advance = async (n) => {
    const started = performance.now()
    for (let i = 0; i < n; i += 60)
      await page.evaluate(
        async (count) => {
          await window.__gummyStudy.advanceFrames(count)
        },
        Math.min(60, n - i),
      )
    report.timings.push({
      steps: n,
      simulationSeconds: n / 120,
      wallSeconds: (performance.now() - started) / 1000,
      capture: false,
    })
  }
  let initialTopology
  let restMetrics
  const sample = async (name, picture = false) => {
    const state = await page.evaluate(async () => {
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
      return copy(await window.__gummyStudy.readState())
    })
    if (process.env.GUMMY_STATES_DIR) {
      mkdirSync(process.env.GUMMY_STATES_DIR, { recursive: true })
      writeFileSync(
        resolve(process.env.GUMMY_STATES_DIR, `${name}.json`),
        JSON.stringify(state),
      )
    }
    initialTopology ??= state.topology
    const s = {
      name,
      ...analyzeRuntimeJelly(state, initialTopology),
      info: await page.evaluate(() => window.__gummyStudy.info()),
    }
    const plastic =
      state.dynamic?.jellyPlasticState?.equivalentPlasticStrain ?? []
    s.plasticity = {
      yieldedTets: plastic.filter((v) => v > 1e-5).length,
      maxStrain: Math.max(0, ...plastic),
      meanStrain:
        plastic.reduce((sum, v) => sum + v, 0) / Math.max(1, plastic.length),
    }
    restMetrics ??= s
    result.manualSamples.push(s)
    check(s.finite, `${name}: finite state`)
    check(
      s.tetCount === restMetrics.tetCount,
      `${name}: retain every tetrahedron`,
    )
    check(
      Math.abs(s.freeMass / restMetrics.freeMass - 1) < 1e-6,
      `${name}: conserve inertial mass`,
    )
    check(
      s.pinnedMovement < 1e-5 && s.floorPenetration < 1e-5,
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
      check(s[key] === 0, `${name}: ${key}=${s[key]}`)
    check(
      s.invertedVolumeFraction < 0.001,
      `${name}: inverted volume below 0.1%`,
    )
    check(Math.abs(s.volumeRatio - 1) < 0.05, `${name}: volume error below 5%`)
    check(
      Math.abs(s.restVolume / initialTopology.restVolume - 1) < 1e-6,
      `${name}: preserve rest volume`,
    )
    console.log(
      JSON.stringify({
        name,
        revision: s.revision,
        failed: s.failedFaces,
        parts: s.mechanicalComponents.length,
        volume: s.volumeRatio,
        inversion: s.invertedVolumeFraction,
        plasticity: s.plasticity,
      }),
    )
    if (picture) await screenshot(name)
    return s
  }
  const grip = (value) =>
    page.waitForFunction(
      (expected) => window.__gummyStudy.info().grip === expected,
      value,
    )
  const shortPull = async (name, pixels, touch = false) => {
    const point = await gummyArmPoint(page)
    const cdp = touch ? await context.newCDPSession(page) : undefined
    const event = (type, x = point.x, y = point.y) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
      })
    if (touch) {
      await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 1,
      })
      await event('touchStart')
    } else {
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
    }
    await grip(true)
    let firstCrackPixels
    for (let i = 1; i <= 8; i++) {
      const dx = (pixels * i) / 8
      if (touch) await event('touchMove', point.x + dx, point.y - dx * 0.2)
      else await page.mouse.move(point.x + dx, point.y - dx * 0.2)
      await advance(6)
      const info = await page.evaluate(() => window.__gummyStudy.info())
      if (info.topologyRevision > 0) firstCrackPixels ??= dx
    }
    await advance(24)
    const held = await sample(`${name}-held`, true)
    if (touch) {
      await event('touchEnd')
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await cdp.detach()
    } else await page.mouse.up()
    await grip(false)
    await advance(240)
    const released = await sample(`${name}-released`, true)
    result.shortDrags.push({
      name,
      pixels,
      touch,
      firstCrackPixels,
      simulationSecondsHeld: 0.6,
      heldRevision: held.revision,
      releasedRevision: released.revision,
      detachedVolumeFraction: released.detachedRestVolumeFraction,
    })
    return released
  }
  await button('Grab & pull').click()
  await tearing.check()
  await setFragility(88)
  assert.equal(
    await button('Demo tear').count(),
    0,
    'Continuous tear is manual-first',
  )
  if (production) {
    assert.equal(await page.evaluate(() => window.__gummyStudy), undefined)
    // Production has no diagnostic hook. Project the known arm location through
    // the documented default studio camera, then use actual pointer input.
    await reset()
    const box = await canvas.boundingBox()
    const phi = 1.27,
      theta = 0.14
    const p = [0.65, -0.07, 0.13]
    const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0)
    const depth =
      5.1 -
      dot(p, [
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.cos(theta),
      ])
    const scale = box.height / (2 * Math.tan(Math.PI / 8) * depth)
    const x =
      box.x +
      box.width / 2 +
      scale * dot(p, [Math.cos(theta), 0, -Math.sin(theta)])
    const y =
      box.y +
      box.height / 2 -
      scale *
        dot(p, [
          -Math.cos(phi) * Math.sin(theta),
          Math.sin(phi),
          -Math.cos(phi) * Math.cos(theta),
        ])
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 45, y - 9, { steps: 12 })
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
            .topologyRevision,
        ) > 0,
    )
    await page.mouse.up()
    await freeze()
    // Pausing stops new ticks; let an already queued fracture update finish.
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
          .mutationPending === 'false',
    )
    result.productionTopologyRevision = await canvas.getAttribute(
      'data-topology-revision',
    )
    result.productionSurfaces = []
    for (const surface of ['original', 'rounded']) {
      await button(surface === 'rounded' ? 'Rounded' : 'Original').click()
      await page.waitForFunction(
        (expected) =>
          document.querySelector('[data-testid="gummy-bear-canvas"]').dataset
            .surface === expected,
        surface,
      )
      assert.equal(
        await canvas.getAttribute('data-topology-revision'),
        result.productionTopologyRevision,
      )
      assert.equal(
        await button('Resume').count(),
        1,
        'Surface comparison keeps production paused',
      )
      result.productionSurfaces.push({
        surface,
        revision: result.productionTopologyRevision,
      })
    }
    await screenshot('production-manual')
    return result
  }
  await reset()
  const generation = await page.evaluateHandle(() => window.__gummyStudy)
  const rest = await sample('rest', true)
  if (process.env.GUMMY_SURFACE_CHECKS === '1')
    result.surfaces = [
      await checkGummyRoundedSurface(page, output, prefix, 'intact'),
    ]
  if (process.env.GUMMY_SURFACE_ONLY === '1') {
    assert.equal(process.env.GUMMY_SURFACE_CHECKS, '1')
    result.surfaceOnly = true
    await shortPull('surface-review', 100)
    result.surfaces.push(
      await checkGummyRoundedSurface(page, output, prefix, 'torn'),
    )
    await reset()
    await sample('reset')
    return result
  }
  if (report.idleProbe) {
    let previous = 0
    for (const tick of [6, 12, 30, 60, 120, 300, 600, 1200, 2400, 7200]) {
      await advance(tick - previous)
      previous = tick
      const s = await sample(`idle-${tick}`)
      check(s.failedFaces === 0, `idle-${tick}: no spontaneous fracture`)
      if (soft)
        check(
          s.plasticity.yieldedTets === 0,
          `idle-${tick}: no spontaneous permanent strain`,
        )
    }
    check(
      await generation.evaluate((g) => g === window.__gummyStudy),
      'Source must remain frozen during idle convergence verification',
    )
    return result
  }
  await advance(1200)
  const idle = await sample('idle')
  check(
    idle.revision === 0 && idle.failedFaces === 0,
    'High fragility must stay intact at rest',
  )
  if (soft)
    check(
      idle.plasticity.yieldedTets === 0,
      'Soft material must not yield under idle gravity',
    )
  await setFragility(100)
  await reset()
  await advance(1200)
  const maximumIdle = await sample('maximum-fragility-idle')
  check(
    maximumIdle.revision === 0 && maximumIdle.failedFaces === 0,
    'Maximum fragility must also remain intact at rest',
  )
  if (soft)
    check(
      maximumIdle.plasticity.yieldedTets === 0,
      'Maximum fragility must not cause idle plasticity',
    )
  if (soft) {
    const softness = page.getByRole('slider', { name: /Softness/ })
    await softness.fill('1')
    await reset()
    await advance(1200)
    const softestIdle = await sample('maximum-softness-idle')
    check(
      softestIdle.revision === 0 && softestIdle.failedFaces === 0,
      'The softest untouched material must not fracture under its own weight',
    )
    await softness.fill('0.55')
  }
  await setFragility(88)
  await tearing.uncheck()
  await reset()
  const disabled = await shortPull('disabled', 45)
  check(
    disabled.revision === 0 && disabled.failedFaces === 0,
    'Tearing off keeps the solid connected',
  )
  if (soft)
    check(
      disabled.plasticity.yieldedTets > 0,
      'Soft material must keep permanent strain when tearing is disabled',
    )
  await tearing.check()
  await setFragility(0)
  await reset()
  const strong = await shortPull('strong', 45)
  check(
    strong.detachedRestVolumeFraction === 0,
    'The same short drag must not detach material at minimum fragility',
  )
  await setFragility(88)
  await reset()
  const hot = await shortPull('hot-mouse', 45)
  check(
    hot.revision > strong.revision,
    'High fragility fractures sooner than the tough setting',
  )
  check(
    // The same physical amount must detach at either resolution. Requiring one
    // coarse chunk would reject the finer fragments this comparison is meant
    // to exercise. Mechanical components union ANY shared vertex, so a chip
    // still tied to the pinned body at a point or edge cannot contribute.
    hot.detachedRestVolumeFraction > 0.001,
    'Short mouse drag mechanically detaches more than 0.1% of the material',
  )
  await reset()
  const touch = await shortPull('hot-touch', 45, true)
  check(
    touch.detachedRestVolumeFraction > 0.001,
    'Short touch drag mechanically detaches more than 0.1% of the material',
  )
  await reset()
  await shortPull('surface-review', 100)
  if (process.env.GUMMY_SURFACE_CHECKS === '1')
    result.surfaces.push(
      await checkGummyRoundedSurface(page, output, prefix, 'torn'),
    )
  await page.getByRole('radio', { name: 'Blue', exact: true }).check()
  await page.evaluate(() => {
    window.__gummyStudy.render()
  })
  await sample('blue-fragments', true)
  await page.getByRole('radio', { name: 'Marble', exact: true }).check()
  await reset()
  const resetState = await sample('reset')
  check(
    resetState.vertexCount === rest.vertexCount && resetState.failedFaces === 0,
    'Reset restores uncut material',
  )
  check(
    resetState.plasticity.yieldedTets === 0,
    'Reset clears permanent deformation',
  )
  check(
    await generation.evaluate((g) => g === window.__gummyStudy),
    'Source must remain frozen during verification',
  )
  return result
}
