// Musical progress, motion-off completion and retained poses keep the crossing honest.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_TRACE, QUIET_MUSIC } from '../src/observatory/scene'
import { createTideweavePresentation, earnedBridgeSpans, nextBridgeReveal, } from '../src/observatory/tideweave'
import type { ObservatoryFrame } from '../src/observatory/scene'

const frame: ObservatoryFrame = {
  selectedWorld: 'tideweave',
  view: 'trace',
  camera: { yaw: 0, pitch: 0, distance: 1 },
  time: 0,
  music: QUIET_MUSIC,
  instructionNote: null,
  motion: true,
  clay: false,
  trace: { ...EMPTY_TRACE, phase: 'answer' },
}

await test('four musical notes build the whole five-module crossing without overflow', () => {
  assert.equal(earnedBridgeSpans(0), 0)
  assert.equal(earnedBridgeSpans(2), 2.5)
  assert.equal(earnedBridgeSpans(4), 5)
  assert.equal(earnedBridgeSpans(99), 5)
  for (const value of [NaN, Infinity, -Infinity])
    assert.equal(earnedBridgeSpans(value), 0)
  assert.equal(earnedBridgeSpans(2, 0), 0)
})

await test('pausing halfway through growth settles every earned span immediately', () => {
  const inFlight = nextBridgeReveal(3.8, 5, 0.05, true)
  assert.ok(inFlight > 3.8 && inFlight < 5)
  assert.equal(nextBridgeReveal(inFlight, 5, 0, false), 5)
  assert.equal(nextBridgeReveal(5, 0, 0, true), 0)
  assert.ok(
    nextBridgeReveal(0, 5, 100, true) <= 0.125,
    'background time cannot create a leap',
  )
})

await test('earned note motion is bounded, does not replay on entry, and reuses its arrays', () => {
  const presentation = createTideweavePresentation()
  const matrix = presentation.stations[0].matrix
  const tint = presentation.stations[0].tint
  presentation.update(frame, 0)
  const earned = {
    ...frame,
    time: 1,
    trace: { ...frame.trace, acceptedSegments: 1 },
  }
  presentation.update(earned, 1.25)
  const settledY = matrix[13]
  presentation.update({ ...earned, time: 1.2 }, 1.25)
  assert.ok(matrix[13] > settledY && matrix[13] < settledY + 0.025)
  presentation.update({ ...earned, time: 1.2, motion: false }, 1.25)
  assert.equal(matrix[13], settledY)
  presentation.update({ ...earned, view: 'overview', time: 1.3 }, 1.25)
  presentation.update({ ...earned, time: 1.5 }, 1.25)
  assert.equal(
    matrix[13],
    settledY,
    'returning to an earned note does not award it again',
  )
  assert.equal(presentation.stations[0].matrix, matrix)
  assert.equal(presentation.stations[0].tint, tint)
})

await test('motion-off instruction can change color while all note transforms stay stationary', () => {
  const presentation = createTideweavePresentation()
  const instruction = {
    ...frame,
    motion: false,
    trace: { ...frame.trace, phase: 'demo' as const },
  }
  presentation.update(instruction, 0)
  const matrices = presentation.stations.map((station) =>
    Array.from(station.matrix),
  )
  const before = Array.from(presentation.stations[2].tint)
  presentation.update({ ...instruction, time: 50, instructionNote: 2 }, 0)
  assert.deepEqual(
    presentation.stations.map((station) => Array.from(station.matrix)),
    matrices,
  )
  assert.notDeepEqual(Array.from(presentation.stations[2].tint), before)
  assert.ok(presentation.spans.every((span) => span.reveal === 0))
})
