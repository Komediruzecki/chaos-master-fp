// Temple geometry, presentation bounds and authored framing must remain independent of playback timing.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_TRACE, projectPoint, QUIET_MUSIC, sceneCamera, } from '../src/observatory/scene'
import { copyTemple, createTempleConnections, createTempleParts, EMPTY_TEMPLE, TEMPLE_CENTER, TEMPLE_SEAL, TEMPLE_WORLD_PLACEMENTS, templePartVisible, } from '../src/observatory/temple'
import type { ObservatoryFrame } from '../src/observatory/scene'

const frame: ObservatoryFrame = {
  selectedWorld: 'glasswake',
  view: 'temple',
  camera: { yaw: 0, pitch: 0, distance: 1 },
  time: 0,
  music: QUIET_MUSIC,
  instructionNote: null,
  clay: false,
  trace: EMPTY_TRACE,
}

await test('temple meshes have finite outward face normals, real thickness and bounded cost', () => {
  const pieces = [...createTempleParts(), ...createTempleConnections()]
  let totalTriangles = 0
  let totalBytes = 0
  for (const { geometry } of pieces) {
    assert.ok([...geometry.vertices].every(Number.isFinite))
    assert.ok(geometry.bounds.max[2] - geometry.bounds.min[2] > 0.01)
    assert.equal(geometry.indices.length, geometry.triangles * 3)
    assert.equal(
      geometry.bytes,
      geometry.vertices.byteLength + geometry.indices.byteLength,
    )
    for (let offset = 0; offset < geometry.indices.length; offset += 3) {
      const points = Array.from(
        geometry.indices.slice(offset, offset + 3),
        (index) =>
          Array.from(geometry.vertices.slice(index * 16, index * 16 + 3)),
      )
      const a = points[1].map((value, index) => value - points[0][index])
      const b = points[2].map((value, index) => value - points[0][index])
      const cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ]
      const area = Math.hypot(...cross)
      assert.ok(area > 1e-7, 'the temple has no degenerate triangles')
      const vertex = geometry.indices[offset] * 16
      const normal = geometry.vertices.slice(vertex + 4, vertex + 7)
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6)
      const agreement =
        cross.reduce((sum, value, axis) => sum + value * normal[axis], 0) / area
      assert.ok(agreement > 0.99999, 'normal follows the visible front face')
      assert.equal(
        geometry.vertices[vertex + 11],
        1,
        'stone and markings stay opaque',
      )
    }
    totalTriangles += geometry.triangles
    totalBytes += geometry.bytes
  }
  assert.ok(totalTriangles < 3500, `${totalTriangles} temple triangles`)
  assert.ok(totalBytes < 450_000, `${totalBytes} temple mesh bytes`)
})

await test('each stone beam is closed, consistently wound and faces outward', () => {
  for (const { id, geometry } of createTempleParts()) {
    const stoneFaces = Array.from(
      { length: geometry.triangles },
      (_, index) => index,
    ).filter(
      (index) => geometry.vertices[geometry.indices[index * 3] * 16 + 12] < 0.2,
    )
    const edges = new Map<string, { triangle: number; direction: number }[]>()
    const parents = stoneFaces.map((_, index) => index)
    const volumes: number[] = []
    const root = (index: number): number => {
      while (parents[index] !== index) index = parents[index]
      return index
    }
    for (const [triangle, face] of stoneFaces.entries()) {
      const points = Array.from(
        geometry.indices.slice(face * 3, face * 3 + 3),
        (index) =>
          Array.from(geometry.vertices.slice(index * 16, index * 16 + 3)),
      )
      // Weld across hard-normal seams at a precision below the smallest bevel.
      const keys = points.map((point) =>
        point.map((value) => value.toFixed(5)).join(','),
      )
      for (let corner = 0; corner < 3; corner++) {
        const from = keys[corner]
        const to = keys[(corner + 1) % 3]
        const key = [from, to].sort().join('|')
        const uses = edges.get(key) ?? []
        uses.push({ triangle, direction: from < to ? 1 : -1 })
        edges.set(key, uses)
      }
      const [a, b, c] = points
      volumes.push(
        (a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
          6,
      )
    }
    for (const uses of edges.values()) {
      assert.equal(uses.length, 2, `${id} has an open or non-manifold edge`)
      assert.equal(
        uses[0].direction + uses[1].direction,
        0,
        `${id} has inconsistent winding`,
      )
      parents[root(uses[1].triangle)] = root(uses[0].triangle)
    }
    const components = new Map<number, number>()
    for (const [index, volume] of volumes.entries()) {
      const component = root(index)
      components.set(component, (components.get(component) ?? 0) + volume)
    }
    for (const volume of components.values())
      assert.ok(volume > 1e-7, `${id} contains an inward-facing or flat solid`)
  }
})

await test('both worlds contribute distinct geometry and returned meshes are caller owned', () => {
  const first = createTempleParts()
  const second = createTempleParts()
  assert.deepEqual(first, second)
  const radial = first.find((part) => part.id === 'radial-inscription')!
  const branching = first.find((part) => part.id === 'branching-inscription')!
  assert.notDeepEqual(radial.geometry.vertices, branching.geometry.vertices)
  assert.ok(radial.geometry.materials.includes('Glasswake gold'))
  assert.ok(branching.geometry.materials.includes('Tideweave enamel'))
  first[0].geometry.vertices[0] = 100
  assert.deepEqual(second, createTempleParts())
})

await test('partial formation stays partial and reduced motion makes all architecture readable', () => {
  const parts = createTempleParts()
  const partial = { active: true, progress: 0.3, revealed: false }
  const visible = parts.filter((part) => templePartVisible(part, partial, true))
  assert.ok(visible.length > 0 && visible.length < parts.length)
  assert.equal(
    visible.some((part) => part.id === 'joined-seal'),
    false,
  )
  assert.equal(
    parts.filter((part) => templePartVisible(part, partial, false)).length,
    parts.length,
  )
  assert.equal(
    parts.filter((part) => templePartVisible(part, EMPTY_TEMPLE, false)).length,
    0,
  )
  assert.equal(
    parts.filter((part) =>
      templePartVisible(part, { ...partial, revealed: true }, true),
    ).length,
    parts.length,
  )
})

await test('non-finite and out-of-range presentation cannot poison scene transforms', () => {
  assert.deepEqual(
    copyTemple({ active: true, progress: Number.NaN, revealed: false }),
    { active: true, progress: 0, revealed: false },
  )
  assert.equal(
    copyTemple({ active: true, progress: Infinity, revealed: false }).progress,
    0,
  )
  assert.equal(
    copyTemple({ active: true, progress: -2, revealed: false }).progress,
    0,
  )
  assert.equal(
    copyTemple({ active: true, progress: 99, revealed: false }).progress,
    1,
  )
})

await test('temple stage, world cores and central seal fit desktop and narrow viewports', () => {
  const parts = createTempleParts()
  for (const aspect of [1440 / 950, 820 / 900, 390 / 844, 844 / 390]) {
    const camera = sceneCamera(frame, aspect)
    const seal = projectPoint(camera.viewProjection, TEMPLE_SEAL)
    assert.ok(
      seal.visible && seal.y > 0.16 && seal.y < 0.66,
      'seal stays clear of header and lower controls',
    )
    for (const part of parts)
      for (
        let offset = 0;
        offset < part.geometry.vertices.length;
        offset += 16
      ) {
        const screen = projectPoint(camera.viewProjection, [
          part.geometry.vertices[offset] + TEMPLE_CENTER[0],
          part.geometry.vertices[offset + 1] + TEMPLE_CENTER[1],
          part.geometry.vertices[offset + 2] + TEMPLE_CENTER[2],
        ])
        assert.ok(screen.visible, `${part.id} clipped at aspect ${aspect}`)
        assert.ok(
          screen.y > 0.1 && screen.y < 0.8,
          'threshold remains between persistent controls',
        )
      }
    for (const world of Object.values(TEMPLE_WORLD_PLACEMENTS))
      for (const side of [-1, 1]) {
        const screen = projectPoint(camera.viewProjection, [
          world.center[0] + side * world.scale * 1.5,
          world.center[1],
          world.center[2],
        ])
        assert.ok(screen.visible, 'both framing orbs remain visible')
      }
  }
})

await test('camera stays fixed throughout the score and ignores stale orbit input', () => {
  const start = sceneCamera(frame, 1.6)
  const end = sceneCamera(
    {
      ...frame,
      time: 100,
      camera: { yaw: 0.7, pitch: 0.5, distance: 0.7 },
      temple: { active: true, progress: 1, revealed: true },
    },
    1.6,
  )
  assert.deepEqual([...start.viewProjection], [...end.viewProjection])
})
