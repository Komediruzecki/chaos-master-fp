// Spatial response tests exercise missed segments, interruption and completion independently of rendering.
import assert from 'node:assert/strict'
import test from 'node:test'
import { BRIDGE_PHRASES, FIRST_BRIDGE_PHRASE, } from '../src/observatory/bridgePhrases'
import { beginTrace, BRIDGE_TARGET, createEncounter, endTrace, moveTrace, traceHint, } from '../src/observatory/encounter'
import type { BridgePhrase } from '../src/observatory/bridgePhrases'
import type { EncounterState, TracePoint } from '../src/observatory/encounter'

function follow(
  state: EncounterState,
  from: TracePoint,
  to: TracePoint,
  phrase: BridgePhrase = FIRST_BRIDGE_PHRASE,
) {
  let next = state
  for (let step = 1; step <= 12; step++) {
    next = moveTrace(
      next,
      [
        from[0] + ((to[0] - from[0]) * step) / 12,
        from[1] + ((to[1] - from[1]) * step) / 12,
      ],
      phrase,
    )
  }
  return next
}

void test('bridge follows an ordered continuous four-note path', () => {
  let state = beginTrace(createEncounter(), BRIDGE_TARGET[0])
  for (let index = 1; index < BRIDGE_TARGET.length; index++) {
    state = follow(state, BRIDGE_TARGET[index - 1], BRIDGE_TARGET[index])
    assert.equal(state.accepted, index + 1)
  }
  assert.equal(state.hint, 'complete')
  assert.equal(state.drawing, false)
})

void test('later notes cannot start or skip the spatial response', () => {
  assert.equal(beginTrace(createEncounter(), BRIDGE_TARGET[2]).accepted, 0)
  let state = beginTrace(createEncounter(), BRIDGE_TARGET[0])
  state = moveTrace(state, BRIDGE_TARGET[3])
  assert.equal(state.accepted, 1)
  assert.equal(state.drawing, false)
  assert.equal(state.hint, 'gap')
})

void test('nonfinite and out-of-bounds points never add progress', () => {
  for (const point of [
    [NaN, 0],
    [0, Infinity],
    [-0.01, 0.3],
    [0.5, 1.01],
  ] as const) {
    assert.equal(beginTrace(createEncounter(), point).accepted, 0)
    const state = moveTrace(
      beginTrace(createEncounter(), BRIDGE_TARGET[0]),
      point,
    )
    assert.equal(state.accepted, 1)
    assert.equal(state.drawing, false)
  }
})

void test('off-path movement stops the stroke without removing earned sections', () => {
  let state = beginTrace(createEncounter(), BRIDGE_TARGET[0])
  state = moveTrace(state, [0.05, 0.9])
  assert.equal(state.accepted, 1)
  assert.equal(state.drawing, false)
})

void test('a lifted stroke resumes from its last completed note', () => {
  const begun = beginTrace(createEncounter(), BRIDGE_TARGET[0])
  const second = follow(begun, BRIDGE_TARGET[0], BRIDGE_TARGET[1])
  const lifted = endTrace(second)
  assert.equal(lifted.accepted, 2)
  assert.equal(moveTrace(lifted, BRIDGE_TARGET[2]).accepted, 2)
  assert.equal(beginTrace(lifted, BRIDGE_TARGET[0]).drawing, false)
  const resumed = beginTrace(lifted, BRIDGE_TARGET[1])
  assert.equal(resumed.drawing, true)
  assert.equal(follow(resumed, BRIDGE_TARGET[1], BRIDGE_TARGET[2]).accepted, 3)
})

void test('completed bridges remain complete through later input', () => {
  let state = beginTrace(createEncounter(), BRIDGE_TARGET[0])
  for (let index = 1; index < BRIDGE_TARGET.length; index++)
    state = follow(state, BRIDGE_TARGET[index - 1], BRIDGE_TARGET[index])
  assert.equal(beginTrace(state, BRIDGE_TARGET[0]), state)
  assert.equal(moveTrace(state, [NaN, Infinity]), state)
  assert.equal(endTrace(state).accepted, 4)
})

for (const phrase of BRIDGE_PHRASES) {
  void test(`${phrase.title} accepts its own contour and resumes only from its last earned note`, () => {
    let state = beginTrace(createEncounter(), phrase.target[0], phrase)
    state = follow(state, phrase.target[0], phrase.target[1], phrase)
    assert.equal(state.accepted, 2)
    const interrupted = endTrace(state, undefined, phrase)
    assert.equal(interrupted.drawing, false)
    assert.deepEqual(interrupted.response, phrase.target.slice(0, 2))
    assert.equal(
      beginTrace(interrupted, phrase.target[0], phrase).drawing,
      false,
    )
    assert.ok(traceHint(interrupted, phrase).includes(phrase.noteNames[1]))
    state = beginTrace(interrupted, phrase.target[1], phrase)
    for (let index = 2; index < phrase.target.length; index++)
      state = follow(
        state,
        phrase.target[index - 1],
        phrase.target[index],
        phrase,
      )
    assert.equal(state.accepted, 4)
    assert.equal(state.hint, 'complete')
    assert.equal(state.drawing, false)
    assert.deepEqual(endTrace(state, undefined, phrase).response, phrase.target)
  })

  void test(`${phrase.title} rejects skipped notes and invalid movement without erasing progress`, () => {
    assert.equal(
      beginTrace(createEncounter(), phrase.target[2], phrase).accepted,
      0,
    )
    const begun = beginTrace(createEncounter(), phrase.target[0], phrase)
    for (const point of [phrase.target[3], [NaN, 0], [-1, 0.5]] as const) {
      const rejected = moveTrace(begun, point, phrase)
      assert.equal(rejected.accepted, 1)
      assert.equal(rejected.drawing, false)
      assert.deepEqual(rejected.response, phrase.target.slice(0, 1))
    }
  })
}

void test('replaying the old contour does not complete a different selected phrase', () => {
  const turning = BRIDGE_PHRASES[1]
  const begun = beginTrace(createEncounter(), turning.target[0], turning)
  const rejected = follow(begun, BRIDGE_TARGET[0], BRIDGE_TARGET[1], turning)
  assert.equal(rejected.accepted, 1)
  assert.equal(rejected.drawing, false)
  assert.equal(rejected.hint, 'rejoin')
  assert.deepEqual(rejected.response, turning.target.slice(0, 1))
  const homeward = BRIDGE_PHRASES[2]
  assert.equal(
    beginTrace(createEncounter(), BRIDGE_TARGET[0], homeward).accepted,
    0,
  )
  assert.ok(traceHint(createEncounter(), homeward).startsWith('Press on B'))
})
