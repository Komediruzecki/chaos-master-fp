// Scene cut coverage, latest intent and motion-off arrival are deterministic.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PASSAGE_DURATION_MS, ScenePassage } from '../src/observatory/passage'
import { EMPTY_TRACE, QUIET_MUSIC, sceneCamera } from '../src/observatory/scene'
import type { PassagePlace } from '../src/observatory/passage'
import type { ObservatoryFrame } from '../src/observatory/scene'

const terrace: PassagePlace = { view: 'overview', worldId: 'glasswake' }
const crossing: PassagePlace = { view: 'trace', worldId: 'tideweave' }
const glass: PassagePlace = { view: 'glasswake', worldId: 'glasswake' }

await test('the old set remains until covered, then the new camera settles before interaction', () => {
  const passage = new ScenePassage(terrace)
  passage.request(crossing, 1000, true)
  assert.equal(passage.read(1000).remainingMs, PASSAGE_DURATION_MS)
  passage.advance(1090)
  assert.deepEqual(passage.read(1090).scene, terrace)
  assert.equal(passage.read(1090).opacity, 0.5)
  passage.advance(1180)
  assert.deepEqual(passage.read(1180).scene, crossing)
  assert.equal(passage.read(1180).opacity, 1)
  assert.equal(passage.read(1180).arrival, 1)
  passage.advance(1410)
  assert.equal(passage.read(1410).opacity, 0.5)
  assert.equal(passage.read(1410).arrival, 0.125)
  passage.advance(1640)
  assert.deepEqual(passage.read(1640), {
    active: false,
    phase: 'idle',
    scene: crossing,
    target: crossing,
    opacity: 0,
    arrival: 0,
    remainingMs: 0,
  })
})

await test('retargeting preserves cover and only arrives at the latest destination', () => {
  const passage = new ScenePassage(terrace)
  passage.request(crossing, 0, true)
  passage.advance(90)
  passage.request(glass, 90, true)
  assert.equal(passage.read(90).opacity, 0.5)
  passage.advance(180)
  assert.deepEqual(passage.read(180).scene, glass)
  passage.advance(1000)
  assert.deepEqual(passage.read(1000).scene, glass)
  assert.equal(passage.read(1000).active, false)
  passage.request(crossing, 1000, true)
  passage.advance(1300)
  const before = passage.read(1300).opacity
  passage.request(terrace, 1300, true)
  assert.equal(passage.read(1300).opacity, before)
  passage.advance(2000)
  assert.deepEqual(passage.read(2000).scene, terrace)
})

await test('motion-off, interruption and long background gaps cannot leave an overlay or stale target', () => {
  const passage = new ScenePassage(terrace)
  passage.request(crossing, 0, true)
  passage.finish()
  assert.equal(passage.read(90).active, false)
  assert.deepEqual(passage.read(90).scene, crossing)
  passage.request(glass, 100, false)
  assert.equal(passage.read(100).arrival, 0)
  assert.equal(passage.read(100).opacity, 0)
  assert.deepEqual(passage.read(100).scene, glass)
  passage.request(crossing, 200, true)
  passage.advance(100000)
  assert.equal(passage.read(100000).active, false)
})

await test('wide-world selection and repeated destinations do not restart the passage', () => {
  const passage = new ScenePassage(terrace)
  passage.request({ ...terrace, worldId: 'tideweave' }, 0, true)
  assert.equal(passage.read(0).active, false)
  passage.request(crossing, 10, true)
  passage.request(crossing, 100, true)
  assert.equal(passage.read(100).remainingMs, PASSAGE_DURATION_MS - 90)
})

await test('arrival changes only a bounded distance and restores the exact encounter projection', () => {
  const frame: ObservatoryFrame = {
    selectedWorld: 'tideweave',
    view: 'trace',
    camera: { yaw: 0, pitch: 0, distance: 1 },
    time: 0,
    music: QUIET_MUSIC,
    instructionNote: null,
    clay: false,
    trace: EMPTY_TRACE,
  }
  for (const aspect of [390 / 844, 1, 1440 / 900, 900 / 540]) {
    const resting = sceneCamera(frame, aspect)
    const arriving = sceneCamera({ ...frame, arrival: 1 }, aspect)
    assert.ok(Math.abs(arriving.eye[2] - resting.eye[2]) > 0.1)
    assert.ok(Math.abs(arriving.eye[2] - resting.eye[2]) < 0.11)
    assert.deepEqual(sceneCamera({ ...frame, arrival: 0 }, aspect), resting)
    assert.deepEqual(sceneCamera({ ...frame, arrival: -1 }, aspect), resting)
  }
})
