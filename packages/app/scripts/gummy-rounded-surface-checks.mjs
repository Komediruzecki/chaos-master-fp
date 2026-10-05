/** Compare both render surfaces on one paused simulation without changing its material state. */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function checkGummyRoundedSurface(page, output, prefix, phase) {
  const before = await page.evaluate(() => window.__gummyStudy.info())
  const generation = await page.evaluateHandle(() => window.__gummyStudy)
  const state = () =>
    page.evaluate(async () => {
      const copy = (value) =>
        ArrayBuffer.isView(value)
          ? Array.from(value)
          : Array.isArray(value)
            ? value.map(copy)
            : value && typeof value === 'object'
              ? Object.fromEntries(
                  Object.entries(value).map(([key, item]) => [key, copy(item)]),
                )
              : value
      return copy(await window.__gummyStudy.readState())
    })
  const originalState = await state()
  const pictures = []
  const observations = []
  for (const surface of ['original', 'rounded', 'original']) {
    await page
      .getByRole('button', {
        name: surface === 'rounded' ? 'Rounded' : 'Original',
        exact: true,
      })
      .click()
    await page.waitForFunction(
      (expected) => window.__gummyStudy.info().surface === expected,
      surface,
    )
    await page.evaluate(async () => {
      window.__gummyStudy.render()
      await new Promise((done) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(done)),
      )
    })
    const info = await page.evaluate(() => window.__gummyStudy.info())
    assert.equal(
      info.time,
      before.time,
      'Surface choice does not advance paused physics',
    )
    assert.equal(
      info.topologyRevision,
      before.topologyRevision,
      'Surface choice retains the fracture',
    )
    assert.deepEqual(
      info.settings,
      before.settings,
      'Surface choice retains the material',
    )
    assert.deepEqual(
      await state(),
      originalState,
      'Surface choice leaves the full solver state unchanged',
    )
    assert.ok(
      await generation.evaluate((g) => g === window.__gummyStudy),
      'Surface choice keeps the scene alive',
    )
    const geometry = await page.evaluate(async () => {
      const value = await window.__gummyStudy.readSurfacePositions()
      return {
        positions: Array.from(value.positions),
        restPositions: Array.from(value.restPositions),
      }
    })
    let moved = 0
    let maximumDisplacement = 0
    for (let node = 0; node < geometry.positions.length / 4; node++) {
      const offset = node * 4
      const displacement = Math.hypot(
        ...[0, 1, 2].map(
          (axis) =>
            geometry.positions[offset + axis] -
            originalState.positions[offset + axis],
        ),
      )
      assert.ok(Number.isFinite(displacement), 'Finite render positions')
      if (displacement > 1e-7) moved++
      maximumDisplacement = Math.max(maximumDisplacement, displacement)
      for (let axis = 0; axis < 3; axis++)
        assert.ok(
          Number.isFinite(geometry.restPositions[offset + axis]),
          'Finite material coordinates',
        )
    }
    if (surface === 'original' || phase === 'intact')
      assert.equal(
        moved,
        0,
        'Only the rounded torn surface moves render corners',
      )
    else assert.ok(moved > 0, 'Rounded surface moves actual corners')
    pictures.push(
      await page.getByTestId('gummy-bear-canvas').screenshot({
        path: resolve(output, `${prefix}-${phase}-${surface}.png`),
      }),
    )
    observations.push({
      surface,
      revision: info.topologyRevision,
      time: info.time,
      relaxedControlCorners: moved,
      maximumControlDisplacement: maximumDisplacement,
    })
  }
  assert.ok(
    pictures[0].equals(pictures[2]),
    'Returning to Original restores the same pixels',
  )
  const changed = !pictures[0].equals(pictures[1])
  assert.equal(
    changed,
    phase !== 'intact',
    phase === 'intact'
      ? 'Intact geometry remains visually unchanged'
      : 'Rounded geometry visibly changes torn corners',
  )
  await page
    .getByRole('button', {
      name: before.surface === 'rounded' ? 'Rounded' : 'Original',
      exact: true,
    })
    .click()
  await generation.dispose()
  return { phase, changed, observations }
}
