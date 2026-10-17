// Projecting the trace and reversing pointer rays must agree at every supported layout.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyTrace, EMPTY_TRACE, projectPoint, QUIET_MUSIC, sceneCamera, traceAtCanvas, traceWorld, WORLD_PLACEMENTS, } from '../src/observatory/scene'
import { createWorldOrnaments } from '../src/observatory/worldOrnaments'
import type { ObservatoryFrame, TracePoint } from '../src/observatory/scene'

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
const targets: TracePoint[] = [
  [0.12, 0.78],
  [0.37, 0.56],
  [0.63, 0.16],
  [0.88, 0.32],
]

await test('desktop, tablet and phone trace projections return the original normalized input', () => {
  for (const aspect of [1440 / 900, 820 / 1180, 390 / 844, 844 / 390]) {
    const camera = sceneCamera(frame, aspect)
    assert.ok(camera.eye[2] < -1, 'trace camera must stay ahead of the lectern')
    const bridge = projectPoint(camera.viewProjection, [0, 0, -5.2])
    assert.ok(
      bridge.visible && bridge.y < 0.7,
      'growing bridge must remain in the visible scene',
    )
    for (const target of targets) {
      const screen = projectPoint(camera.viewProjection, traceWorld(target))
      assert.equal(screen.visible, true)
      assert.ok(screen.y < 0.65, 'trace must remain above the lower controls')
      const actual = traceAtCanvas(camera.inverse, screen.x, screen.y)
      assert.ok(actual)
      assert.ok(Math.abs(actual[0] - target[0]) < 0.0001)
      assert.ok(Math.abs(actual[1] - target[1]) < 0.0001)
    }
  }
})

await test('higher pitches rise in world and projected coordinates without reversing time', () => {
  const camera = sceneCamera(frame, 1.6)
  const low = projectPoint(camera.viewProjection, traceWorld(targets[0]))
  const high = projectPoint(camera.viewProjection, traceWorld(targets[2]))
  assert.ok(high.x > low.x)
  assert.ok(high.y < low.y)
  assert.ok(traceWorld(targets[2])[1] > traceWorld(targets[0])[1])
})

await test('inspection fits both authored frames on desktop and narrow screens', () => {
  for (const selectedWorld of ['glasswake', 'tideweave'] as const) {
    const world = WORLD_PLACEMENTS[selectedWorld]
    const geometry = createWorldOrnaments(selectedWorld)
    for (const aspect of [1440 / 950, 820 / 900, 390 / 844, 844 / 390]) {
      const camera = sceneCamera(
        { ...frame, view: 'inspect', selectedWorld },
        aspect,
      )
      for (let vertex = 0; vertex < geometry.vertices.length; vertex += 16) {
        const screen = projectPoint(camera.viewProjection, [
          world.center[0] + geometry.vertices[vertex] * world.scale,
          world.center[1] + geometry.vertices[vertex + 1] * world.scale,
          world.center[2] + geometry.vertices[vertex + 2] * world.scale,
        ])
        assert.ok(
          screen.visible,
          `${selectedWorld} ornament clipped at aspect ${aspect}`,
        )
        assert.ok(
          screen.y > 0.06 && screen.y < 0.85,
          'ornament should fit between the main header and footer',
        )
      }
    }
  }
})

await test('pointer rays outside the plane are rejected rather than converted into an edge answer', () => {
  const camera = sceneCamera(frame, 1.6)
  assert.equal(traceAtCanvas(camera.inverse, -0.1, 0.5), null)
  assert.equal(traceAtCanvas(camera.inverse, Number.NaN, 0.5), null)
  assert.equal(traceAtCanvas(camera.inverse, 0.01, 0.99), null)
})

await test('trace view is independent of orbit input so its plane never moves during an answer', () => {
  const a = sceneCamera(frame, 1.6)
  const b = sceneCamera(
    { ...frame, camera: { yaw: 0.9, pitch: 0.3, distance: 1.6 } },
    1.6,
  )
  assert.deepEqual([...a.viewProjection], [...b.viewProjection])
})

await test('presentation copies caller-owned trace data and bounds display memory', () => {
  const points: [number, number][] = [
    [0.2, 0.3],
    [0.7, 0.9],
  ]
  const copied = copyTrace({
    phase: 'answer',
    target: points,
    response: Array.from({ length: 600 }, () => [0.5, 0.5] as const),
    acceptedSegments: 99,
    segmentCount: 4,
  })
  points[0][0] = 1
  assert.equal(copied.target[0][0], 0.2)
  assert.equal(copied.response.length, 512)
  assert.equal(copied.acceptedSegments, 4)
})
