// Exercise the shipped deformation on the actual cloud, independent of GPU compilation.
import assert from 'node:assert/strict'
import test from 'node:test'
import { d } from 'typegpu'
import { deformFlamePoint } from '../src/flameMotion'
import { POINT_COUNT, sampleCachedPoints } from '../src/sampling'

const cached = sampleCachedPoints()
const points = Array.from({ length: POINT_COUNT }, (_, index) => {
  const offset = index * 4
  return d.vec4f(
    cached[offset],
    cached[offset + 1],
    cached[offset + 2],
    cached[offset + 3],
  )
})

function coordinates(point: d.v3f) {
  return [point.x, point.y, point.z]
}

function distance(a: d.v3f, b: d.v3f) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

await test('zero envelopes preserve the rest cloud and independent inspection rotation', () => {
  const silent = d.vec4f(0)
  for (const point of points) {
    const rest = d
      .vec3f(point.xyz)
      .mul(0.7)
      .add(d.vec3f(0, 1.6, -2.5))
    assert.deepEqual(
      coordinates(deformFlamePoint(point, silent, 0, 0)),
      coordinates(rest),
    )
    const oriented = deformFlamePoint(point, silent, 0, 17)
    assert.deepEqual(
      coordinates(deformFlamePoint(point, silent, 3600, 17)),
      coordinates(oriented),
    )
  }
  const quarterTurn = deformFlamePoint(
    d.vec4f(1, 0, 0, 1),
    silent,
    0,
    Math.PI / (2 * 0.08),
  )
  assert.ok(Math.abs(quarterTurn.x) < 1e-12)
  assert.ok(Math.abs(quarterTurn.y - 1.6) < 1e-6)
  assert.ok(Math.abs(quarterTurn.z + 3.2) < 1e-6)
})

await test('maximum music remains finite inside the orb displacement budget', (context) => {
  const full = d.vec4f(1)
  const silent = d.vec4f(0)
  const phases = [0, 0.5, 2, 8, 14, 24, 48, 96, 3600]
  let maximum = 0
  for (const point of points) {
    const rest = deformFlamePoint(point, silent, 0, 0)
    const restRadius = Math.hypot(rest.x, rest.z + 2.5)
    for (const phase of phases) {
      const moved = deformFlamePoint(point, full, phase, 0)
      assert.ok(coordinates(moved).every(Number.isFinite))
      // At most 30% horizontal expansion, regardless of the local twist.
      assert.ok(Math.hypot(moved.x, moved.z + 2.5) <= restRadius * 1.3 + 1e-12)
      // Vertical scaling changes at most 7%; the waves add less than 14 cm.
      assert.ok(
        Math.abs(moved.y - rest.y) <= Math.abs(rest.y - 1.6) * 0.07 + 0.14,
      )
      maximum = Math.max(maximum, distance(moved, rest))
    }
  }
  assert.ok(maximum < 0.8, `maximum displacement was ${maximum} metres`)
  context.diagnostic(`maximum measured displacement: ${maximum.toFixed(6)} m`)
})

await test('representative soundtrack envelopes visibly fold the cloud without rotation', (context) => {
  // Calibrated score medians, with the shipped 65% motion setting applied.
  const bands = d.vec4f(0.536 * 0.65, 0.498 * 0.65, 0.489 * 0.65, 0.407 * 0.65)
  const originalBands = [bands.x, bands.y, bands.z, bands.w]
  const originalCache = cached.slice()
  let squaredDistance = 0
  let movedPoints = 0
  for (const point of points) {
    const before = [point.x, point.y, point.z, point.w]
    const early = deformFlamePoint(point, bands, 8, 0)
    const late = deformFlamePoint(point, bands, 14, 0)
    const movement = distance(early, late)
    squaredDistance += movement * movement
    if (movement > 0.03) movedPoints++
    assert.deepEqual(
      coordinates(deformFlamePoint(point, bands, 8, 0)),
      coordinates(early),
    )
    assert.deepEqual([point.x, point.y, point.z, point.w], before)
  }
  const rms = Math.sqrt(squaredDistance / POINT_COUNT)
  // Five centimetres RMS is a scene-space readability gate, not a pixel snapshot.
  assert.ok(rms > 0.05, `six-second motion RMS was only ${rms} metres`)
  assert.ok(
    movedPoints / POINT_COUNT > 0.65,
    'motion affected too little of the cloud',
  )
  assert.deepEqual([bands.x, bands.y, bands.z, bands.w], originalBands)
  assert.deepEqual(cached, originalCache)
  context.diagnostic(
    `six-second motion RMS: ${rms.toFixed(6)} m; ${((100 * movedPoints) / POINT_COUNT).toFixed(2)}% moved over 3 cm`,
  )
})
