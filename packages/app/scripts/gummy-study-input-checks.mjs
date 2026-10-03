/** Mouse, keyboard and real CDP touch coverage against the integrated gummy canvas. */
import assert from 'node:assert/strict'

export async function waitForGummyControlsLayout(page) {
  // Resize commits before matchMedia's change event. Resolve controls only
  // after the page has switched their owner, or a click can retain the old
  // sidebar button while it becomes hidden on the next compositor frame.
  await page.waitForFunction(() => {
    const compact = window.matchMedia('(max-width: 720px)').matches
    const studio = document.querySelector(
      '[data-testid="gummy-studio-actions"]',
    )
    const sidebar = document.querySelector(
      '[data-testid="gummy-sidebar-actions"]',
    )
    const canvas = document.querySelector('[data-testid="gummy-bear-canvas"]')
    const canvasBox = canvas?.getBoundingClientRect()
    const active = compact ? studio : sidebar
    return (
      studio &&
      sidebar &&
      studio.hidden === !compact &&
      sidebar.hidden === compact &&
      active &&
      window.getComputedStyle(active).display !== 'none' &&
      active.getBoundingClientRect().height > 0 &&
      canvas &&
      canvasBox &&
      canvasBox.width > 0 &&
      canvasBox.height > 0 &&
      Math.abs(canvas.width - canvasBox.width) <= 1 &&
      Math.abs(canvas.height - canvasBox.height) <= 1
    )
  })
}

export async function checkGummyInputs(page, context) {
  const canvas = page.getByTestId('gummy-bear-canvas')
  const button = (name) => page.getByRole('button', { name, exact: true })
  const resize = async (viewport) => {
    await page.setViewportSize(viewport)
    await waitForGummyControlsLayout(page)
  }
  const reset = async () => {
    await button('Reset bear').click()
    await button('Pause').click()
    await button('Reset view').click()
    await canvas.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      ;(window.__gummyParticleStudy ?? window.__gummyStudy).render()
    })
  }
  const armPoint = () =>
    page.evaluate(async () => {
      const {
        DEFAULT_GUMMY_CRUSH_ORBIT,
        DEFAULT_GUMMY_ORBIT,
        gummyCameraMatrices,
        layGummyBearBack,
      } = await import('/src/components/GummyBear/gummyStudyMath.ts')
      const info = (window.__gummyParticleStudy ?? window.__gummyStudy).info()
      const experiment =
        info.pose === 'laid' || info.experiment === 'crush' ? 'crush' : 'pull'
      const canvas = document.querySelector('[data-testid="gummy-bear-canvas"]')
      const box = canvas.getBoundingClientRect()
      const matrix = new Float32Array(16)
      gummyCameraMatrices(
        experiment === 'crush'
          ? DEFAULT_GUMMY_CRUSH_ORBIT
          : DEFAULT_GUMMY_ORBIT,
        box.width / box.height,
        matrix,
        new Float32Array(16),
        new Float32Array(3),
        experiment,
      )
      const upright = new Float32Array([0.65, 1.25, 0.13, 1])
      const posed = experiment === 'crush' ? layGummyBearBack(upright) : upright
      const p = [posed[0], posed[1], posed[2], 1]
      const clip = [0, 1, 2, 3].map((row) =>
        p.reduce(
          (sum, value, column) => sum + matrix[column * 4 + row] * value,
          0,
        ),
      )
      return {
        x: box.x + (box.width * (clip[0] / clip[3] + 1)) / 2,
        y: box.y + (box.height * (1 - clip[1] / clip[3])) / 2,
      }
    })
  const expectGrip = (value) =>
    page.waitForFunction(
      (expected) =>
        (window.__gummyParticleStudy ?? window.__gummyStudy).info().grip ===
        expected,
      value,
    )
  const advance = (count) =>
    page.evaluate(async (steps) => {
      ;(window.__gummyParticleStudy ?? window.__gummyStudy).advanceFrames(steps)
      const state = await (
        window.__gummyParticleStudy ?? window.__gummyStudy
      ).readState()
      return Array.from(state.positions)
    }, count)
  const moved = (a, b) =>
    Math.max(...a.map((value, index) => Math.abs(value - b[index])))
  const result = {
    experiment: await page.evaluate(
      () =>
        (window.__gummyParticleStudy ?? window.__gummyStudy).info().experiment,
    ),
  }

  await resize({ width: 1440, height: 1000 })
  await reset()
  const mousePoint = await armPoint()
  await page.mouse.move(mousePoint.x, mousePoint.y)
  await page.mouse.down()
  await expectGrip(true)
  const beforeMouse = await advance(1)
  await page.mouse.move(mousePoint.x + 95, mousePoint.y - 20, { steps: 12 })
  const afterMouse = await advance(36)
  await page.mouse.up()
  await expectGrip(false)
  result.mouseDisplacement = moved(beforeMouse, afterMouse)
  assert.ok(result.mouseDisplacement > 0.03, 'Mouse drag must deform the solid')

  await reset()
  await canvas.press('Space')
  await button('Pause').waitFor()
  await canvas.press('Space')
  await button('Resume').waitFor()
  const front = await canvas.screenshot()
  await canvas.press('ArrowRight')
  await page.evaluate(() => {
    ;(window.__gummyParticleStudy ?? window.__gummyStudy).render()
  })
  const turned = await canvas.screenshot()
  assert.ok(!front.equals(turned), 'Arrow key must rotate the visible view')
  result.keyboard = true
  await button('Reset view').click()

  await button('Orbit').click()
  await reset()
  const orbitBox = await canvas.boundingBox()
  assert.ok(orbitBox, 'The orbit canvas must be visible')
  const beforeOrbit = await canvas.screenshot()
  await page.mouse.move(
    orbitBox.x + orbitBox.width / 2,
    orbitBox.y + orbitBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    orbitBox.x + orbitBox.width / 2 + 75,
    orbitBox.y + orbitBox.height / 2 + 25,
    { steps: 10 },
  )
  await page.mouse.up()
  await page.evaluate(() => {
    ;(window.__gummyParticleStudy ?? window.__gummyStudy).render()
  })
  const afterOrbit = await canvas.screenshot()
  assert.ok(!beforeOrbit.equals(afterOrbit), 'Orbit drag must turn the view')
  await expectGrip(false)
  result.mouseOrbit = true
  await button('Grab & pull').click()

  await resize({ width: 390, height: 844 })
  await reset()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  })
  await page.evaluate(() => {
    window.__gummyTouchEvents = []
    const canvas = document.querySelector('[data-testid="gummy-bear-canvas"]')
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
    ]) {
      canvas.addEventListener(type, (event) =>
        window.__gummyTouchEvents.push({
          type,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          trusted: event.isTrusted,
        }),
      )
    }
  })
  const point = await armPoint()
  const touch = (type, x = point.x, y = point.y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }],
    })
  await touch('touchStart')
  await expectGrip(true)
  const beforeTouch = await advance(1)
  for (let step = 1; step <= 8; step++)
    await touch('touchMove', point.x + step * 5, point.y - step * 2)
  const afterTouch = await advance(36)
  await touch('touchEnd')
  await expectGrip(false)
  result.touchDisplacement = moved(beforeTouch, afterTouch)
  assert.ok(result.touchDisplacement > 0.03, 'Touch drag must deform the solid')
  await reset()
  await touch('touchStart')
  await expectGrip(true)
  await touch('touchCancel')
  await expectGrip(false)
  result.touchEvents = await page.evaluate(() => window.__gummyTouchEvents)
  assert.ok(
    result.touchEvents.some(
      (event) =>
        event.type === 'pointercancel' &&
        event.pointerType === 'touch' &&
        event.trusted,
    ),
    'Cancellation must traverse the actual touch input path',
  )
  assert.ok(
    result.touchEvents.some(
      (event) =>
        event.type === 'pointerup' &&
        event.pointerType === 'touch' &&
        event.trusted,
    ),
    'Touch release must reach the canvas',
  )

  await button('Orbit').click()
  await reset()
  const pinchBox = await canvas.boundingBox()
  assert.ok(pinchBox, 'The pinch canvas must be visible')
  const center = {
    x: pinchBox.x + pinchBox.width / 2,
    y: pinchBox.y + pinchBox.height / 2,
  }
  const beforePinch = await canvas.screenshot()
  const pinch = (type, distance) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { x: center.x - distance, y: center.y, id: 1 },
              { x: center.x + distance, y: center.y, id: 2 },
            ],
    })
  await pinch('touchStart', 35)
  await pinch('touchMove', 65)
  await pinch('touchEnd')
  await expectGrip(false)
  await page.evaluate(() => {
    ;(window.__gummyParticleStudy ?? window.__gummyStudy).render()
  })
  const afterPinch = await canvas.screenshot()
  assert.ok(
    !beforePinch.equals(afterPinch),
    'Two-finger pinch must change the view',
  )
  result.touchPinch = true
  await button('Grab & pull').click()
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await cdp.detach()
  await resize({ width: 1024, height: 768 })
  await reset()
  result.tablet = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }))
  assert.equal(
    result.tablet.viewport,
    result.tablet.content,
    'Tablet controls must fit without horizontal scrolling',
  )
  return result
}
