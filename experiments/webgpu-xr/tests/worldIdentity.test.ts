// Presentation must preserve accepted samples and remain stable at every density.
import assert from 'node:assert/strict'
import test from 'node:test'
import { d } from 'typegpu'
import { ALMANAC_WORLDS, settingsForWorld } from '../src/almanac/catalog'
import { worldPoint } from '../src/almanac/worldComposition'
import { WORLD_VISUALS } from '../src/almanac/worldIdentity'
import { SAMPLE_STEPS, sampleSpecimen } from '../src/bench/recipes'
import { DEFAULT_BENCH_SETTINGS, normalizeSettings, } from '../src/bench/settings'

const xyz = (point: d.v3f) => [point.x, point.y, point.z]

await test('Almanac studies select distinct explicit visuals without changing their retained recipe and seed', () => {
  const glass = settingsForWorld(ALMANAC_WORLDS[0])!
  const tide = settingsForWorld(ALMANAC_WORLDS[1])!
  assert.deepEqual(
    [glass.recipe, glass.seed, glass.worldVisual],
    [0, 73129, 'glasswake'],
  )
  assert.deepEqual(
    [tide.recipe, tide.seed, tide.worldVisual],
    [1, 73129, 'tideweave'],
  )
  assert.notDeepEqual(WORLD_VISUALS.glasswake.low, WORLD_VISUALS.tideweave.low)
  assert.notDeepEqual(
    WORLD_VISUALS.glasswake.high,
    WORLD_VISUALS.tideweave.high,
  )
  assert.equal(
    normalizeSettings({ ...DEFAULT_BENCH_SETTINGS }).worldVisual,
    undefined,
  )
})

await test('raw bench and Glasswake preserve every accepted Aureole coordinate exactly', () => {
  const retained = sampleSpecimen(0, 32768)
  for (let index = 0; index < retained.length / 4; index++) {
    const point = d.vec3f(
      retained[index * 4],
      retained[index * 4 + 1],
      retained[index * 4 + 2],
    )
    assert.deepEqual(xyz(worldPoint(point, index, 0)), xyz(point))
    assert.deepEqual(
      xyz(worldPoint(point, index, WORLD_VISUALS.glasswake.style)),
      xyz(point),
    )
  }
})

await test('Tideweave keeps each retained chain on one frond and repeats only after five complete chains', () => {
  const point = d.vec3f(0.12, 0.2, -0.08)
  const style = WORLD_VISUALS.tideweave.style
  const first = xyz(worldPoint(point, 0, style))
  assert.deepEqual(xyz(worldPoint(point, SAMPLE_STEPS - 1, style)), first)
  assert.notDeepEqual(xyz(worldPoint(point, SAMPLE_STEPS, style)), first)
  assert.deepEqual(xyz(worldPoint(point, SAMPLE_STEPS * 5, style)), first)
  const positions = Array.from({ length: 5 }, (_, frond) =>
    worldPoint(point, frond * SAMPLE_STEPS, style),
  )
  for (const position of positions) {
    assert.ok(Math.abs(position.y - positions[0].y) < 1e-6)
    assert.ok(
      Math.abs(
        Math.hypot(position.x, position.z) -
          Math.hypot(positions[0].x, positions[0].z),
      ) < 1e-6,
    )
  }
  assert.ok(Math.abs(positions.reduce((sum, p) => sum + p.x, 0)) < 1e-5)
  assert.ok(Math.abs(positions.reduce((sum, p) => sum + p.z, 0)) < 1e-5)
})

await test('composed Thicket remains finite, bounded and spatially deep without changing point count or density prefixes', () => {
  const small = sampleSpecimen(1, 32768)
  const larger = sampleSpecimen(1, 32768 + SAMPLE_STEPS)
  assert.deepEqual(larger.subarray(0, small.length), small)
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < small.length / 4; index++) {
    const p = worldPoint(
      d.vec3f(small[index * 4], small[index * 4 + 1], small[index * 4 + 2]),
      index,
      WORLD_VISUALS.tideweave.style,
    )
    for (const [axis, value] of xyz(p).entries()) {
      assert.ok(Number.isFinite(value))
      assert.ok(Math.abs(value) < 1.1)
      minimum[axis] = Math.min(minimum[axis], value)
      maximum[axis] = Math.max(maximum[axis], value)
    }
  }
  assert.ok(maximum[0] - minimum[0] > 1.5)
  assert.ok(maximum[1] - minimum[1] > 1.9)
  assert.ok(maximum[2] - minimum[2] > 1.5)
})
