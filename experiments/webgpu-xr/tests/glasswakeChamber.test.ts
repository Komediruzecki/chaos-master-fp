// Tone-star placement, score-bound illumination and chamber resource lifetime regressions.
import assert from 'node:assert/strict'
import test from 'node:test'
import { chamberLight, GLASSWAKE_TONE_STAR_POSITIONS, toneStarMatrix, toneStarTint, } from '../src/observatory/glasswakeChamber'
import { createGlasswakeChamberMaterial, glasswakeChamberFragment, } from '../src/observatory/glasswakeChamberMaterial'
import { EMPTY_GLASSWAKE } from '../src/observatory/scene'
import type { GlasswakePresentation } from '../src/observatory/scene'

const state = (overrides: Partial<GlasswakePresentation> = {}) => ({
  ...EMPTY_GLASSWAKE,
  ...overrides,
})

function close(actual: readonly number[], expected: readonly number[]) {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) < 0.000001,
      `${index}: ${value} differs from ${expected[index]}`,
    )
  })
}

await test('three stars occupy the curved petal centres and point radially outward without scale', () => {
  const expected = [
    [0, 2.36, -4.45],
    [-0.7880831174438392, 0.995, -4.45],
    [0.7880831174438392, 0.995, -4.45],
  ]
  for (let group = 0; group < 3; group++) {
    close(GLASSWAKE_TONE_STAR_POSITIONS[group], expected[group])
    const matrix = toneStarMatrix(group)
    close(Array.from(matrix.slice(12, 15)), expected[group])
    close(Array.from(matrix.slice(4, 7)), [
      expected[group][0] / 0.91,
      (expected[group][1] - 1.45) / 0.91,
      0,
    ])
    for (const offset of [0, 4, 8])
      assert.ok(
        Math.abs(Math.hypot(...matrix.slice(offset, offset + 3)) - 1) < 1e-6,
      )
    assert.equal(matrix[15], 1)
    assert.deepEqual(toneStarMatrix(group), matrix, 'no hidden animation state')
  }
})

await test('only the held target star lights, and cancellation ignores stale charge', () => {
  close(toneStarTint(0, state(), true), [0.279, 0.387, 0.45, 0])
  const holding = state({ holding: true, charge: 0.6 })
  close(toneStarTint(0, holding, true), [0.5208, 0.7224, 0.84, 0.31])
  close(toneStarTint(1, holding, true), [0.45, 0.3735, 0.2475, 0])
  close(
    toneStarTint(0, { ...holding, holding: false, charge: 1 }, true),
    [0.279, 0.387, 0.45, 0],
  )
  close(
    toneStarTint(1, state({ accepted: 1, holding: true, charge: 1 }), true),
    [1, 0.83, 0.55, 0.49],
  )
})

await test('accepted light waits 350 ms for the shatter and reaches full glow at one second', () => {
  const opened = state({ accepted: 1, burstTimes: [10] })
  for (const time of [9, 10, 10.2, 10.35])
    assert.equal(toneStarTint(0, { ...opened, time }, true)[3], 0)
  assert.ok(
    Math.abs(toneStarTint(0, { ...opened, time: 10.675 }, true)[3] - 0.425) <
      1e-12,
  )
  close(toneStarTint(0, { ...opened, time: 11 }, true), [0.62, 0.86, 1, 0.85])
  let previous = 0
  for (let step = 0; step <= 100; step++) {
    const presentation = { ...opened, time: 10 + step / 100 }
    const tint = toneStarTint(0, presentation, true)
    assert.deepEqual(tint, toneStarTint(0, presentation, true))
    assert.ok(tint[3] >= previous && tint[3] <= 0.85)
    previous = tint[3]
  }
})

await test('reduced motion settles stars immediately, restored seals remain lit and rebuilding dims them', () => {
  const justOpened = state({ accepted: 3, time: 10, burstTimes: [10, 10, 10] })
  for (let group = 0; group < 3; group++) {
    const still = toneStarTint(group, justOpened, false)
    assert.equal(still[3], 0.85)
    assert.deepEqual(
      still,
      toneStarTint(group, { ...justOpened, time: 20 }, false),
    )
    assert.equal(toneStarTint(group, state({ accepted: 3 }), true)[3], 0.85)
    assert.equal(toneStarTint(group, state(), true)[3], 0)
    assert.deepEqual(toneStarTint(group, justOpened, true, true), [1, 1, 1, 0])
  }
})

await test('chamber warmth follows earned seals, rises through holds and drops back on cancellation', () => {
  close(
    [0, 1, 2, 3].map((accepted) => chamberLight(state({ accepted }), true)),
    [0.55, 0.7, 0.85, 1],
  )
  assert.ok(
    Math.abs(chamberLight(state({ holding: true, charge: 0.6 }), true) - 0.61) <
      1e-12,
  )
  assert.equal(chamberLight(state({ holding: false, charge: 1 }), true), 0.55)
  assert.equal(
    chamberLight(state({ accepted: 3, holding: true, charge: 1 }), true),
    1,
  )
  for (let accepted = 0; accepted < 3; accepted++) {
    let previous = 0
    for (let step = 0; step <= 100; step++) {
      const presentation = state({
        accepted,
        holding: true,
        charge: step / 100,
      })
      const current = chamberLight(presentation, true)
      assert.ok(current >= previous)
      assert.equal(chamberLight(presentation, false), current)
      previous = current
    }
    assert.ok(chamberLight(state({ accepted: accepted + 1 }), true) > previous)
  }
})

await test('malformed numeric presentation stays finite, clamps to three seals and never invents charge', () => {
  for (const value of [Number.NaN, Infinity, -Infinity, -100]) {
    close(
      toneStarTint(
        0,
        state({ accepted: value, charge: value, time: value }),
        true,
      ),
      [0.279, 0.387, 0.45, 0],
    )
    assert.equal(chamberLight(state({ accepted: value }), true), 0.55)
    assert.equal(
      chamberLight(state({ holding: true, charge: value }), true),
      0.55,
    )
    assert.deepEqual(toneStarMatrix(value), toneStarMatrix(0))
  }
  assert.equal(chamberLight(state({ accepted: 100 }), true), 1)
  close([chamberLight(state({ accepted: 2.9 }), true)], [0.85])
  close(
    toneStarTint(0, state({ holding: true, charge: 100 }), true),
    [0.62, 0.86, 1, 0.49],
  )
  assert.equal(
    toneStarTint(0, state({ accepted: 1, burstTimes: [Number.NaN] }), true)[3],
    0.85,
  )
  assert.equal(
    toneStarTint(
      0,
      state({ accepted: 1, burstTimes: [10], time: Number.NaN }),
      true,
    )[3],
    0,
  )
})

function resources(failAt: 'allocation' | 'usage' | 'binding' | null = null) {
  const buffers: { destroyed: number }[] = []
  const writes: number[][] = []
  let bindings = 0
  const root = {
    createBuffer() {
      if (failAt === 'allocation') throw new Error('allocation failed')
      const record = { destroyed: 0 }
      buffers.push(record)
      const buffer = {
        $usage() {
          if (failAt === 'usage') throw new Error('usage failed')
          return buffer
        },
        write(value: ArrayBuffer) {
          writes.push(Array.from(new Float32Array(value.slice(0))))
        },
        destroy() {
          record.destroyed++
        },
      }
      return buffer
    },
    createBindGroup() {
      bindings++
      if (failAt === 'binding') throw new Error('binding failed')
      return {}
    },
  }
  return {
    root: root as unknown as Parameters<
      typeof createGlasswakeChamberMaterial
    >[0],
    buffers,
    writes,
    bindings: () => bindings,
  }
}

await test('one chamber light allocation is reused and each partial construction failure is cleaned', () => {
  for (const failure of ['allocation', 'usage', 'binding'] as const) {
    const probe = resources(failure)
    assert.throws(
      () => createGlasswakeChamberMaterial(probe.root),
      new RegExp(failure),
    )
    assert.equal(probe.buffers.length, failure === 'allocation' ? 0 : 1)
    assert.ok(probe.buffers.every((buffer) => buffer.destroyed === 1))
    assert.equal(probe.writes.length, 0)
  }
  const probe = resources()
  const chamber = createGlasswakeChamberMaterial(probe.root)
  assert.equal(chamber.material.fragment, glasswakeChamberFragment)
  assert.equal(chamber.bytes, 16)
  chamber.update(state(), true)
  chamber.update(state(), true)
  chamber.update(state({ accepted: 2 }), true)
  chamber.update(state({ accepted: 2, time: 100 }), false)
  assert.equal(probe.buffers.length, 1)
  assert.equal(probe.bindings(), 1)
  assert.equal(probe.writes.length, 2)
  close(probe.writes[0], [0.55, 0, 0, 0])
  close(probe.writes[1], [0.85, 0, 0, 0])
  chamber.dispose()
  chamber.dispose()
  chamber.update(state({ accepted: 3 }), true)
  assert.equal(probe.buffers[0].destroyed, 1)
  assert.equal(chamber.bytes, 0)
  assert.equal(
    probe.writes.length,
    2,
    'disposed light cannot upload or allocate',
  )
})
