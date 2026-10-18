// Score light must stay deterministic, while optional temple shading preserves other models and resource cleanup.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bookFragment } from '../src/almanac/bookShaders'
import { TEMPLE_DURATION_SECONDS, TEMPLE_SCORE, } from '../src/journey/templeScore'
import { createModelPass, primitiveGeometry, } from '../src/observatory/modelPass'
import { templeFragment, templeLighting, } from '../src/observatory/templeMaterial'
import { createTemplePass } from '../src/observatory/templePass'

const progressAtBeat = (beat: number) =>
  (beat * 60) / TEMPLE_SCORE.tempo / TEMPLE_DURATION_SECONDS
const at = (beat: number) =>
  templeLighting({
    active: true,
    progress: progressAtBeat(beat),
    revealed: false,
  })

await test('temple lights follow the authored call, answer, duet and cadence in order', () => {
  assert.deepEqual(at(0), { warm: 0, cool: 0, confluence: 0, seal: 0 })
  assert.equal(at(4.5).warm, 0.5)
  assert.equal(at(4.5).cool, 0)
  assert.equal(at(9).warm, 1)
  assert.equal(at(13.5).cool, 0.5)
  assert.equal(at(13.5).confluence, 0)
  assert.equal(at(22).confluence, 0.5)
  assert.equal(at(22).seal, 0)
  assert.ok(at(29).seal > 0 && at(29).seal < 1)
  assert.deepEqual(
    templeLighting({ active: true, progress: 1, revealed: true }),
    {
      warm: 1,
      cool: 1,
      confluence: 1,
      seal: 1,
    },
  )
})

await test('lighting never pulses or advances independently of transport and remains bounded on malformed state', () => {
  let previous = templeLighting({ active: true, progress: 0, revealed: false })
  for (let step = 0; step <= 1000; step++) {
    const state = { active: true, progress: step / 1000, revealed: false }
    const current = templeLighting(state)
    assert.deepEqual(
      current,
      templeLighting(state),
      'unchanged transport stays unchanged',
    )
    for (const key of ['warm', 'cool', 'confluence', 'seal'] as const) {
      assert.ok(current[key] >= previous[key])
      assert.ok(current[key] >= 0 && current[key] <= 1)
    }
    previous = current
  }
  for (const progress of [Number.NaN, Infinity, -Infinity, -1])
    assert.deepEqual(
      templeLighting({ active: true, progress, revealed: false }),
      at(0),
    )
  assert.deepEqual(
    templeLighting({ active: false, progress: 1, revealed: true }),
    at(0),
  )
  assert.deepEqual(
    templeLighting({ active: true, progress: 9, revealed: false }),
    previous,
  )
})

function resources(
  failAt: 'lighting-binding' | 'third-pipeline' | null = null,
) {
  const buffers: { destroyed: number }[] = []
  const fragments: unknown[] = []
  let bindings = 0
  const pipeline = {
    with() {
      return pipeline
    },
    withIndexBuffer() {
      return pipeline
    },
    drawIndexed() {},
  }
  const root = {
    createBuffer() {
      const state = { destroyed: 0 }
      buffers.push(state)
      const buffer = {
        $usage() {
          return buffer
        },
        write() {},
        destroy() {
          state.destroyed++
        },
      }
      return buffer
    },
    createBindGroup() {
      if (++bindings === 1 && failAt === 'lighting-binding')
        throw new Error(failAt)
      return {}
    },
    createRenderPipeline(config: { fragment: unknown }) {
      fragments.push(config.fragment)
      if (fragments.length === 3 && failAt === 'third-pipeline')
        throw new Error(failAt)
      return pipeline
    },
    unwrap() {},
  }
  return {
    root: root as unknown as Parameters<typeof createTemplePass>[0],
    buffers,
    fragments,
  }
}

const camera = {} as Parameters<typeof createTemplePass>[1]

await test('temple shading is optional and every partial temple allocation is released on setup failure', () => {
  const defaultProbe = resources()
  const model = createModelPass(
    defaultProbe.root,
    camera,
    primitiveGeometry('beam'),
  )
  assert.equal(defaultProbe.fragments[0], bookFragment)
  model.dispose()
  for (const failure of ['lighting-binding', 'third-pipeline'] as const) {
    const probe = resources(failure)
    assert.throws(
      () => createTemplePass(probe.root, camera),
      new RegExp(failure),
    )
    assert.ok(probe.buffers.length > 0)
    assert.ok(probe.buffers.every((buffer) => buffer.destroyed === 1))
    assert.ok(probe.fragments.every((fragment) => fragment === templeFragment))
  }
})

await test('temple disposal releases retained geometry and shared light only once', () => {
  const probe = resources()
  const temple = createTemplePass(probe.root, camera)
  temple.draw(
    {} as GPURenderPassEncoder,
    { active: true, progress: 1, revealed: true },
    true,
  )
  assert.ok(temple.stats().sealLit)
  temple.dispose()
  temple.dispose()
  assert.ok(probe.buffers.every((buffer) => buffer.destroyed === 1))
  const allocated = probe.buffers.length
  temple.draw(
    {} as GPURenderPassEncoder,
    { active: true, progress: 1, revealed: true },
    true,
  )
  assert.equal(
    probe.buffers.length,
    allocated,
    'disposed pass cannot allocate a fresh instance',
  )
})
