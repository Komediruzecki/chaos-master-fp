// Crystal seams, solid cut faces and bounded break motion must survive renderer changes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGlasswakeGeometry, GLASSWAKE_BURST_SECONDS, GLASSWAKE_INSTANCE_FLOATS, GLASSWAKE_VERTEX_FLOATS, GLASSWAKE_VERTICES_PER_SHARD, writeGlasswakeInstance, } from '../src/observatory/glasswakeGeometry'
import { EMPTY_TRACE, GLASSWAKE_CENTER, projectPoint, QUIET_MUSIC, sceneCamera, } from '../src/observatory/scene'
import type { GlassPoint, GlasswakeFrame, GlasswakeGeometry, } from '../src/observatory/glasswakeGeometry'

const cross = (a: GlassPoint, b: GlassPoint): GlassPoint => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: GlassPoint, b: GlassPoint) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const subtract = (a: GlassPoint, b: GlassPoint): GlassPoint => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const key = (point: GlassPoint) =>
  point.map((value) => Math.round(value * 1e5)).join(',')
const baseFrame: GlasswakeFrame = {
  center: [0, 1.45, -4.6],
  time: 3,
  charge: 0,
  accepted: 0,
  holding: false,
  burstTimes: [],
  motion: true,
}

await test('every tumbling shard stays inside the scene above encounter controls at supported layouts', () => {
  const geometry = createGlasswakeGeometry()
  const record = new Float32Array(GLASSWAKE_INSTANCE_FLOATS)
  for (const [width, height] of [
    [1440, 950],
    [820, 900],
    [390, 844],
    [844, 390],
  ]) {
    const camera = sceneCamera(
      {
        selectedWorld: 'glasswake',
        view: 'glasswake',
        camera: { yaw: 0, pitch: 0, distance: 1 },
        time: 0,
        music: QUIET_MUSIC,
        instructionNote: null,
        clay: false,
        trace: EMPTY_TRACE,
      },
      width / height,
    )
    for (let tick = 0; tick < 28; tick++) {
      for (let shard = 0; shard < geometry.shards.length; shard++) {
        writeGlasswakeInstance(
          geometry.shards[shard],
          shard,
          {
            ...baseFrame,
            center: GLASSWAKE_CENTER,
            accepted: 3,
            time: tick * 0.05,
            burstTimes: [0, 0, 0],
          },
          record,
          0,
        )
        for (let index = 0; index < GLASSWAKE_VERTICES_PER_SHARD; index++) {
          const [x, y, z] = vertex(geometry, shard, index)
          const screen = projectPoint(camera.viewProjection, [
            record[0] * x + record[4] * y + record[8] * z + record[12],
            record[1] * x + record[5] * y + record[9] * z + record[13],
            record[2] * x + record[6] * y + record[10] * z + record[14],
          ])
          assert.ok(
            screen.visible,
            `${width}x${height}: shard ${shard} clips at ${tick * 0.05}s`,
          )
          // Reserve the real responsive footer area measured by the browser harness.
          const footerLimit =
            width === 820
              ? 0.61
              : width === 390
                ? 0.52
                : width === 844
                  ? 0.54
                  : 0.68
          assert.ok(
            screen.y > 0.05 && screen.y < footerLimit,
            `${width}x${height}: shard ${shard} overlaps header/footer at y=${screen.y}`,
          )
        }
      }
    }
  }
})

function vertex(
  geometry: GlasswakeGeometry,
  shard: number,
  index: number,
): GlassPoint {
  const offset =
    (shard * GLASSWAKE_VERTICES_PER_SHARD + index) * GLASSWAKE_VERTEX_FLOATS
  return [
    geometry.vertices[offset],
    geometry.vertices[offset + 1],
    geometry.vertices[offset + 2],
  ]
}

function sample(frame: GlasswakeFrame) {
  const geometry = createGlasswakeGeometry()
  const records = new Float32Array(
    geometry.shards.length * GLASSWAKE_INSTANCE_FLOATS,
  )
  const visible = geometry.shards.map((shard, index) =>
    writeGlasswakeInstance(
      shard,
      index,
      frame,
      records,
      index * GLASSWAKE_INSTANCE_FLOATS,
    ),
  )
  return { geometry, records, visible }
}

await test('crystals use a small deterministic mesh and preserve independent caller ownership', () => {
  const geometry = createGlasswakeGeometry()
  assert.equal(geometry.shards.length, 48)
  assert.deepEqual(
    [0, 1, 2].map(
      (group) =>
        geometry.shards.filter((shard) => shard.group === group).length,
    ),
    [16, 16, 16],
  )
  assert.equal(geometry.vertices.length, 48 * 24 * 12)
  assert.equal(geometry.triangles, 384)
  assert.equal(geometry.bytes, geometry.vertices.byteLength)
  assert.ok([...geometry.vertices].every(Number.isFinite))
  const second = createGlasswakeGeometry()
  assert.deepEqual(geometry, second)
  geometry.vertices[0] = 99
  geometry.shards[0].group = 99
  geometry.bounds.min[0] = 99
  assert.deepEqual(second, createGlasswakeGeometry())
})

await test('each shard has positive solid volume, correct winding and actual front/back thickness', () => {
  const geometry = createGlasswakeGeometry()
  for (let shard = 0; shard < geometry.shards.length; shard++) {
    const unique = new Map<string, GlassPoint>()
    const edges = new Map<string, { count: number; orientation: number }>()
    let volume = 0
    for (let index = 0; index < 24; index += 3) {
      const points = [
        vertex(geometry, shard, index),
        vertex(geometry, shard, index + 1),
        vertex(geometry, shard, index + 2),
      ]
      const [a, b, c] = points
      const geometric = cross(subtract(b, a), subtract(c, a))
      const area = Math.hypot(...geometric)
      assert.ok(area > 1e-6, 'no zero-area cut faces')
      assert.ok(
        dot(geometric, a) > 0,
        'each face points away from its own shard center',
      )
      volume += dot(a, cross(b, c)) / 6
      points.forEach((point, corner) => {
        const offset = (shard * 24 + index + corner) * 12
        const normal: GlassPoint = [
          geometry.vertices[offset + 4],
          geometry.vertices[offset + 5],
          geometry.vertices[offset + 6],
        ]
        assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6)
        assert.ok(dot(geometric, normal) / area > 0.99999)
        assert.deepEqual(
          Array.from(geometry.vertices.slice(offset + 8, offset + 11)),
          [Number(corner === 0), Number(corner === 1), Number(corner === 2)],
        )
        assert.equal(
          geometry.vertices[offset + 7],
          index < 6 ? 0 : 1,
          'only actual side faces use the cut-face material',
        )
        const from = key(point)
        const to = key(points[(corner + 1) % 3])
        unique.set(from, point)
        const edgeKey = [from, to].sort().join('|')
        const edge = edges.get(edgeKey) ?? { count: 0, orientation: 0 }
        edge.count++
        edge.orientation += from < to ? 1 : -1
        edges.set(edgeKey, edge)
      })
    }
    assert.equal(
      unique.size,
      6,
      'a shard is a closed triangular prism, not a flat triangle',
    )
    assert.ok(volume > 0.0001)
    for (const edge of edges.values()) {
      assert.equal(edge.count, 2, 'every welded edge closes one solid')
      assert.equal(
        edge.orientation,
        0,
        'neighbors traverse shared edges in opposite directions',
      )
    }
    const columns = new Map<string, number[]>()
    for (const point of unique.values()) {
      const columnKey = key([point[0], point[1], 0])
      const column = columns.get(columnKey) ?? []
      column.push(point[2])
      columns.set(columnKey, column)
    }
    assert.equal(columns.size, 3)
    for (const column of columns.values()) {
      assert.equal(column.length, 2)
      assert.ok(Math.abs(Math.abs(column[0] - column[1]) - 0.055) < 1e-6)
    }
  }
})

await test('intact shards tile three coherent petals and leave the Aureole core aperture open', () => {
  const geometry = createGlasswakeGeometry()
  for (let group = 0; group < 3; group++) {
    const edges = new Map<string, number[]>()
    const neighbors = Array.from({ length: 16 }, () => new Set<number>())
    for (let local = 0; local < 16; local++) {
      const shard = group * 16 + local
      const center = geometry.shards[shard].center
      const front = [0, 1, 2].map((index): GlassPoint => {
        const point = vertex(geometry, shard, index)
        return [
          point[0] + center[0],
          point[1] + center[1],
          point[2] + center[2],
        ]
      })
      for (let edge = 0; edge < 3; edge++) {
        const a = front[edge]
        const b = front[(edge + 1) % 3]
        const dx = b[0] - a[0],
          dy = b[1] - a[1]
        const t = Math.max(
          0,
          Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy)),
        )
        assert.ok(
          Math.hypot(a[0] + dx * t, a[1] + dy * t) > 0.68,
          'crystal must not obscure the radius-0.65 core',
        )
        assert.ok(Math.hypot(a[0], a[1]) <= 1.131)
        const edgeKey = [key(a), key(b)].sort().join('|')
        const sharing = edges.get(edgeKey) ?? []
        sharing.push(local)
        edges.set(edgeKey, sharing)
      }
    }
    let boundary = 0
    for (const sharing of edges.values()) {
      assert.ok(sharing.length <= 2, 'no overlapping front faces')
      if (sharing.length === 1) boundary++
      else {
        neighbors[sharing[0]].add(sharing[1])
        neighbors[sharing[1]].add(sharing[0])
      }
    }
    assert.equal(
      boundary,
      18,
      'one continuous curved strip, without cracks before breakup',
    )
    const seen = new Set<number>()
    const pending = [0]
    while (pending.length) {
      const id = pending.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      pending.push(...neighbors[id])
    }
    assert.equal(seen.size, 16, 'every shard joins the same petal')
  }
  assert.ok(
    geometry.bounds.max[2] - geometry.bounds.min[2] > 0.2,
    'petals visibly curve through depth',
  )
})

await test('seals break C/E/G in order and expire within the fixed effect window', () => {
  const intact = sample(baseFrame)
  assert.equal(intact.visible.filter(Boolean).length, 48)
  for (let accepted = 1; accepted <= 3; accepted++) {
    const burst = sample({
      ...baseFrame,
      accepted,
      time: 3.5,
      burstTimes: [3, 3, 3],
    })
    assert.equal(burst.visible.filter(Boolean).length, 48)
    for (let index = 0; index < 48; index++) {
      const offset = index * 24
      if (burst.geometry.shards[index].group < accepted) {
        assert.notDeepEqual(
          burst.records.slice(offset, offset + 16),
          intact.records.slice(offset, offset + 16),
        )
        assert.equal(burst.records[offset + 22], 0.5)
      } else
        assert.deepEqual(
          burst.records.slice(offset, offset + 16),
          intact.records.slice(offset, offset + 16),
        )
    }
    const complete = sample({
      ...baseFrame,
      accepted,
      time: 3 + GLASSWAKE_BURST_SECONDS + 0.001,
      burstTimes: [3, 3, 3],
    })
    assert.equal(complete.visible.filter(Boolean).length, 48 - accepted * 16)
  }
})

await test('reduced motion opens accepted seals immediately and never animates unbroken geometry', () => {
  const start = sample({
    ...baseFrame,
    motion: false,
    accepted: 1,
    holding: true,
    charge: 1,
    burstTimes: [3],
  })
  const later = sample({
    ...baseFrame,
    motion: false,
    accepted: 1,
    holding: true,
    charge: 1,
    burstTimes: [3],
    time: 300,
  })
  assert.equal(start.visible.filter(Boolean).length, 32)
  assert.deepEqual(start.records, later.records)
  const missingTimestamp = sample({ ...baseFrame, accepted: 2 })
  assert.equal(missingTimestamp.visible.filter(Boolean).length, 16)
  const reset = sample({
    ...baseFrame,
    accepted: 0,
    burstTimes: [3, 3, 3],
    time: 300,
  })
  assert.equal(reset.visible.filter(Boolean).length, 48)
  assert.deepEqual(reset.records, sample(baseFrame).records)
})

await test('tumbling keeps finite orthogonal transforms and bounded debris, and charge affects only the next seal', () => {
  const geometry = createGlasswakeGeometry()
  const record = new Float32Array(24)
  for (let tick = 0; tick < 28; tick++) {
    const age = tick * 0.05
    for (let index = 0; index < 48; index++) {
      assert.equal(
        writeGlasswakeInstance(
          geometry.shards[index],
          index,
          { ...baseFrame, accepted: 3, time: age, burstTimes: [0, 0, 0] },
          record,
          0,
        ),
        true,
      )
      assert.ok([...record].every(Number.isFinite))
      assert.ok(record[20] >= 0 && record[20] <= 1)
      assert.equal(
        record[23],
        index,
        'sorting must retain the original static-mesh identity',
      )
      const x: GlassPoint = [record[0], record[1], record[2]]
      const y: GlassPoint = [record[4], record[5], record[6]]
      const z: GlassPoint = [record[8], record[9], record[10]]
      assert.ok(
        Math.abs(dot(x, y)) < 1e-6 &&
          Math.abs(dot(y, z)) < 1e-6 &&
          Math.abs(dot(z, x)) < 1e-6,
      )
      assert.ok(Math.abs(Math.hypot(...x) - Math.hypot(...y)) < 1e-6)
      assert.ok(
        dot(cross(x, y), z) > 0.47,
        'tumbling must never invert or collapse shards',
      )
      assert.ok(
        Math.hypot(
          record[12] - baseFrame.center[0],
          record[13] - baseFrame.center[1],
          record[14] - baseFrame.center[2],
        ) < 2.7,
      )
    }
  }
  const charging = sample({
    ...baseFrame,
    accepted: 1,
    charge: 100,
    holding: true,
    burstTimes: [3],
  })
  for (let index = 0; index < 48; index++)
    assert.equal(
      charging.records[index * 24 + 21],
      geometry.shards[index].group === 1 ? 1 : 0,
    )
  const invalid = sample({ ...baseFrame, charge: Number.NaN, time: Number.NaN })
  assert.ok([...invalid.records].every(Number.isFinite))
})
