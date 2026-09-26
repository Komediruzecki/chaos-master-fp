// Actual Web Audio playback and user-control checks inside the hardware GPU lab.
import assert from 'node:assert/strict'
import path from 'node:path'
import { verifyVisibility } from './verifyVisibility'
import type { Page } from 'playwright'

export async function verifyMusic(
  page: Page,
  production: boolean,
  out: string,
) {
  const read = () => page.evaluate(() => window.__lumenGpuXr!.snapshot())
  const transport = page.locator('.transport')
  if (!production) {
    assert.equal((await read()).music.status, 'idle')
    assert.equal((await read()).musicFrame.energy, 0)
  }
  await page.getByLabel('Scene', { exact: true }).selectOption('compute')
  await page.getByRole('button', { name: 'Play music', exact: true }).click()
  await page.getByRole('button', { name: 'Pause music', exact: true }).waitFor()
  await page.waitForFunction(
    () =>
      (document.querySelector<HTMLMeterElement>('meter')?.value ?? 0) > 0.01,
  )
  let playing
  if (!production) {
    playing = await read()
    assert.equal(playing.music.status, 'playing')
    assert.ok(
      playing.musicFrame.energy > 0.01,
      'Decoded soundtrack reaches the real analyser',
    )
    assert.ok(playing.musicFrame.low > 0.01)
  }
  await page.getByRole('button', { name: 'Pause music', exact: true }).click()
  await page.getByRole('button', { name: 'Play music', exact: true }).waitFor()
  const pausedText = await transport.textContent()
  const paused = production ? undefined : await read()
  // A real-time transport needs a wall-clock wait to prove that pause freezes it.
  await page.waitForTimeout(700)
  assert.equal(await transport.textContent(), pausedText)
  if (paused) {
    const after = await read()
    assert.equal(after.music.elapsed, paused.music.elapsed)
    assert.deepEqual(after.musicFrame, paused.musicFrame)
    await page.getByLabel('Scene', { exact: true }).selectOption('cached')
    await page.getByRole('button', { name: 'Two-eye preview' }).click()
    await page.waitForFunction(
      () => window.__lumenGpuXr?.snapshot().eyes.length === 2,
    )
    assert.deepEqual((await read()).musicFrame, paused.musicFrame)
    await page.getByRole('button', { name: 'Two-eye preview' }).click()
    await page.getByLabel('Scene', { exact: true }).selectOption('compute')
  }
  await page.getByRole('button', { name: 'Play music', exact: true }).click()
  await page.getByRole('button', { name: 'Pause music', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Mute', exact: true }).click()
  assert.equal(
    await page
      .getByRole('button', { name: 'Unmute', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  await page.getByRole('slider', { name: 'Volume', exact: true }).fill('0.3')
  await page
    .getByRole('slider', { name: 'Music motion', exact: true })
    .fill('0.85')
  if (!production) {
    const muted = await read()
    await page.waitForFunction(
      (time) =>
        (window.__lumenGpuXr?.snapshot().musicFrame.time ?? 0) > time + 0.2,
      muted.musicFrame.time,
    )
    const later = await read()
    assert.equal(later.music.muted, true)
    assert.equal(later.music.volume, 0.3)
    assert.equal(later.motionStrength, 0.85)
    assert.ok(later.musicFrame.energy > 0, 'Mute preserves pre-gain analysis')
  }
  await page
    .getByRole('button', { name: 'Start rotation', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Stationary view', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Start rotation', exact: true })
    .waitFor()
  assert.equal(
    await page
      .getByRole('slider', { name: 'Music motion', exact: true })
      .inputValue(),
    '0',
  )
  await page.getByRole('button', { name: 'Restart track', exact: true }).click()
  await page.getByRole('button', { name: 'Pause music', exact: true }).waitFor()
  if (!production) assert.ok((await read()).music.elapsed < 2)
  await page
    .getByRole('slider', { name: 'Music motion', exact: true })
    .fill('0.65')
  await page.getByRole('button', { name: 'Unmute', exact: true }).click()
  await page.waitForFunction(
    () =>
      (document.querySelector<HTMLMeterElement>('meter')?.value ?? 0) > 0.01,
  )
  await page.screenshot({
    path: path.join(out, 'music-orb.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Pause music', exact: true }).click()
  const visibility = await verifyVisibility(page.url())
  return {
    playing,
    paused,
    userInitiated: true,
    mutePreservesAnalysis: true,
    visibility,
    stationaryView: true,
  }
}
