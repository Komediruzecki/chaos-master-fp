// Validate reproducible specimen clouds, useful bounds and distinct three-dimensional silhouettes.
import assert from 'node:assert/strict'
import test from 'node:test'
import { BENCH_RECIPES, BENCH_SEED, sampleSpecimen } from '../src/bench/recipes'

const clouds = BENCH_RECIPES.map((recipe) =>
  sampleSpecimen(recipe.index, 32768),
)

await test('the same specimen has identical points and remains a prefix at higher quality', () => {
  for (const recipe of BENCH_RECIPES) {
    const original = clouds[recipe.index]
    assert.deepEqual(sampleSpecimen(recipe.index, 32768), original)
    assert.deepEqual(
      sampleSpecimen(recipe.index, 131072).slice(0, original.length),
      original,
    )
    assert.notDeepEqual(
      sampleSpecimen(recipe.index, 32768, BENCH_SEED + 1),
      original,
    )
  }
  const largest = sampleSpecimen(0, 524288)
  assert.equal(largest.length, 524288 * 4)
  assert.deepEqual(largest.slice(0, clouds[0].length), clouds[0])
})

await test('each recipe retains finite, bounded geometry and color across independent seeds', (context) => {
  for (const recipe of BENCH_RECIPES) {
    const secondSeed = sampleSpecimen(recipe.index, 32768, 987654)
    let maxRadius = 0
    for (const cloud of [clouds[recipe.index], secondSeed]) {
      assert.ok(cloud.every(Number.isFinite))
      for (let i = 0; i < cloud.length; i += 4) {
        maxRadius = Math.max(
          maxRadius,
          Math.hypot(cloud[i], cloud[i + 1], cloud[i + 2]),
        )
        assert.ok(cloud[i + 3] >= 0 && cloud[i + 3] <= 1)
      }
    }
    assert.ok(maxRadius <= 1.2, `${recipe.id}: radius ${maxRadius}`)
    context.diagnostic(`${recipe.id}: maximum radius ${maxRadius.toFixed(6)}`)
  }
})

await test('curled petals, branches and nested shells occupy different volumes', (context) => {
  const stats = clouds.map((cloud) => {
    const mean = [0, 0, 0]
    const square = [0, 0, 0]
    const cells = new Set<string>()
    let inner = 0
    for (let i = 0; i < cloud.length; i += 4) {
      for (let axis = 0; axis < 3; axis++) {
        mean[axis] += cloud[i + axis] / 32768
        square[axis] += cloud[i + axis] ** 2 / 32768
      }
      if (Math.hypot(cloud[i], cloud[i + 1], cloud[i + 2]) < 0.5) inner++
      cells.add(
        [0, 1, 2].map((axis) => Math.round(cloud[i + axis] * 50)).join(','),
      )
    }
    const variance = square.map((value, axis) => value - mean[axis] ** 2)
    return { variance, innerFraction: inner / 32768, occupiedCells: cells.size }
  })
  context.diagnostic(JSON.stringify(stats))
  // All specimens need real depth, not a flat portrait placed on a billboard.
  for (const stat of stats) {
    assert.ok(Math.min(...stat.variance) > 0.004)
    assert.ok(
      stat.occupiedCells > 1000,
      'specimen collapsed into too few distinct features',
    )
  }
  const [rosette, branch, shell] = stats
  assert.ok(rosette.variance[0] > rosette.variance[2] * 2)
  assert.ok(branch.variance[1] > branch.variance[0] * 2)
  assert.ok(shell.variance[2] > rosette.variance[2] * 2)
  assert.ok(shell.innerFraction > 0.1 && shell.innerFraction < 0.4)
})

await test('invalid CPU recipe requests fail before allocating or sampling', () => {
  assert.throws(() => sampleSpecimen(-1, 32), /Unknown specimen recipe/)
  assert.throws(() => sampleSpecimen(3, 32), /Unknown specimen recipe/)
  assert.throws(() => sampleSpecimen(0, 33), /multiple of 32/)
  assert.throws(() => sampleSpecimen(0, 0), /multiple of 32/)
  assert.throws(() => sampleSpecimen(0, 32, 0), /nonzero u32/)
  assert.throws(() => sampleSpecimen(0, 32, 0xffffffff), /nonzero u32/)
})
