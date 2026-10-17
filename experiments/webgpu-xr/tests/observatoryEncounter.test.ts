// Spatial response tests exercise missed segments, interruption and completion independently of rendering.
import assert from 'node:assert/strict'
import test from 'node:test'
import { beginTrace, BRIDGE_TARGET, createEncounter, endTrace, moveTrace, } from '../src/observatory/encounter'
import type { EncounterState, TracePoint } from '../src/observatory/encounter'

function follow(state: EncounterState, from: TracePoint, to: TracePoint) {
  let next = state
  for (let step = 1; step <= 12; step++) {
    next = moveTrace(next, [
      from[0] + ((to[0] - from[0]) * step) / 12,
      from[1] + ((to[1] - from[1]) * step) / 12,
    ])
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
