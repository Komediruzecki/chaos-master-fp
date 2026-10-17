// Ornament topology must remain closed, outward, deterministic and clear of the live core.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorldOrnaments } from '../src/observatory/worldOrnaments'
import type { BookGeometry } from '../src/almanac/bookAsset'

type Point = readonly [number, number, number]
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const subtract = (a: Point, b: Point): Point => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const position = (geometry: BookGeometry, vertex: number): Point => [
  geometry.vertices[vertex * 16],
  geometry.vertices[vertex * 16 + 1],
  geometry.vertices[vertex * 16 + 2],
]

function inspectSolids(geometry: BookGeometry) {
  const welded = new Map<string, number>()
  const ids: number[] = []
  const parents: number[] = []
  for (let vertex = 0; vertex < geometry.vertices.length / 16; vertex++) {
    const key = position(geometry, vertex).join(',')
    if (!welded.has(key)) {
      parents.push(parents.length)
      welded.set(key, welded.size)
    }
    ids.push(welded.get(key)!)
  }
  const root = (id: number): number => {
    while (parents[id] !== id) id = parents[id]
    return id
  }
  const edges = new Map<string, { count: number; orientation: number }>()
  const triangles: { id: number; volume: number }[] = []
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const indices = Array.from(geometry.indices.slice(offset, offset + 3))
    const [a, b, c] = indices.map((index) => position(geometry, index))
    const normal = cross(subtract(b, a), subtract(c, a))
    const area = Math.hypot(...normal)
    assert.ok(area > 1e-9, `degenerate triangle ${offset / 3}`)
    for (const vertex of indices) {
      const start = vertex * 16 + 4
      const n: Point = [
        geometry.vertices[start],
        geometry.vertices[start + 1],
        geometry.vertices[start + 2],
      ]
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6)
      assert.ok(
        dot(normal, n) / area > 0.99999,
        'geometric normal must agree with winding',
      )
    }
    const corners = indices.map((index) => ids[index])
    for (let edge = 0; edge < 3; edge++) {
      const from = corners[edge]
      const to = corners[(edge + 1) % 3]
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`
      const record = edges.get(key) ?? { count: 0, orientation: 0 }
      record.count++
      record.orientation += from < to ? 1 : -1
      edges.set(key, record)
      parents[root(from)] = root(to)
    }
    triangles.push({ id: corners[0], volume: dot(a, cross(b, c)) / 6 })
  }
  for (const edge of edges.values()) {
    assert.equal(
      edge.count,
      2,
      'every welded edge must close exactly one solid',
    )
    assert.equal(
      edge.orientation,
      0,
      'neighbor faces must use opposite edge directions',
    )
  }
  const volumes = new Map<number, number>()
  for (const triangle of triangles) {
    const component = root(triangle.id)
    volumes.set(component, (volumes.get(component) ?? 0) + triangle.volume)
  }
  assert.ok(
    [...volumes.values()].every((volume) => volume > 1e-6),
    'each closed component must face outward',
  )
  return volumes.size
}

function distanceToTriangle(
  a: Point,
  b: Point,
  c: Point,
  xScale: number,
  yScale: number,
) {
  const points = [a, b, c].map((point) => [
    point[0] / xScale,
    point[1] / yScale,
  ])
  const sides = points.map(
    (p, i) => p[0] * points[(i + 1) % 3][1] - p[1] * points[(i + 1) % 3][0],
  )
  if (sides.every((side) => side > 0) || sides.every((side) => side < 0))
    return 0
  return Math.min(
    ...points.map((p, i) => {
      const q = points[(i + 1) % 3]
      const dx = q[0] - p[0],
        dy = q[1] - p[1]
      const lengthSquared = dx * dx + dy * dy
      const t = lengthSquared
        ? Math.max(0, Math.min(1, -(p[0] * dx + p[1] * dy) / lengthSquared))
        : 0
      return Math.hypot(p[0] + dx * t, p[1] + dy * t)
    }),
  )
}

await test('both ornament meshes have valid opaque factor data and a bounded combined cost', () => {
  let triangles = 0
  for (const world of ['glasswake', 'tideweave'] as const) {
    const geometry = createWorldOrnaments(world)
    triangles += geometry.triangles
    assert.equal(geometry.vertices.length % 16, 0)
    assert.equal(geometry.indices.length, geometry.triangles * 3)
    assert.ok(geometry.triangles > 0)
    assert.equal(
      geometry.bytes,
      geometry.vertices.byteLength + geometry.indices.byteLength,
    )
    assert.ok([...geometry.vertices].every(Number.isFinite))
    assert.ok(
      [...geometry.indices].every(
        (index) => index < geometry.vertices.length / 16,
      ),
    )
    for (let vertex = 0; vertex < geometry.vertices.length / 16; vertex++) {
      const offset = vertex * 16
      assert.equal(geometry.vertices[offset + 3], 1)
      assert.equal(geometry.vertices[offset + 7], 0)
      assert.equal(
        geometry.vertices[offset + 11],
        1,
        'ornaments are opaque, not transparent glass',
      )
      assert.ok(
        geometry.vertices[offset + 14] <= 0.120001,
        'only the restrained seam may emit light',
      )
      for (let channel = 8; channel < 16; channel++)
        assert.ok(
          geometry.vertices[offset + channel] >= 0 &&
            geometry.vertices[offset + channel] <= 1,
        )
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(geometry.vertices[offset + axis] >= geometry.bounds.min[axis])
        assert.ok(geometry.vertices[offset + axis] <= geometry.bounds.max[axis])
      }
    }
    assert.ok(
      Math.max(...geometry.bounds.max, ...geometry.bounds.min.map(Math.abs)) <
        1.6,
    )
    assert.ok(
      geometry.bounds.max[2] - geometry.bounds.min[2] > 0.3,
      'ornaments must have visible depth',
    )
  }
  assert.ok(triangles < 3000, `combined ornament triangles: ${triangles}`)
})

await test('only one narrow Tideweave bevel emits light while the body stays opaque', () => {
  const tide = createWorldOrnaments('tideweave')
  let glowingVertices = 0
  for (let offset = 0; offset < tide.vertices.length; offset += 16) {
    if (tide.vertices[offset + 14] > 0) glowingVertices++
    assert.equal(tide.vertices[offset + 11], 1)
  }
  assert.ok(glowingVertices > 0)
  assert.ok(
    glowingVertices / (tide.vertices.length / 16) < 0.05,
    'the luminous seam must not spread across the body',
  )
  const glass = createWorldOrnaments('glasswake')
  for (let offset = 14; offset < glass.vertices.length; offset += 16)
    assert.equal(
      glass.vertices[offset],
      0,
      'Glasswake facets remain non-emissive',
    )
  assert.ok(
    tide.bounds.max[2] - tide.bounds.min[2] > 1.2,
    'currents must curl through depth instead of forming a flat badge',
  )
})

await test('spire, corona and current pieces are independently closed and outward wound', () => {
  assert.equal(
    inspectSolids(createWorldOrnaments('glasswake')),
    18,
    'six spires and twelve separate corona fragments',
  )
  assert.equal(
    inspectSolids(createWorldOrnaments('tideweave')),
    3,
    'three separate currents',
  )
})

await test('book material channels preserve dielectric porcelain and reflective gold', () => {
  const { vertices } = createWorldOrnaments('glasswake')
  let porcelain = 0
  let gold = 0
  for (let offset = 0; offset < vertices.length; offset += 16) {
    // bookFragment reads surface.x as metal and surface.y as roughness.
    const metal = vertices[offset + 12]
    const roughness = vertices[offset + 13]
    if (vertices[offset + 8] > 0.7 && vertices[offset + 10] > 0.7) {
      porcelain++
      assert.ok(metal < 0.2, 'porcelain must remain mostly dielectric')
      assert.ok(roughness > 0.2 && roughness < 0.4)
    } else if (vertices[offset + 8] > 0.7 && vertices[offset + 10] < 0.2) {
      gold++
      assert.ok(metal > 0.6, 'gold must retain its metallic response')
      assert.ok(roughness > 0.2 && roughness < 0.4)
    }
  }
  assert.ok(porcelain > 0 && gold > 0)
})

await test('front-facing ornament triangles leave the core aperture open', () => {
  for (const world of ['glasswake', 'tideweave'] as const) {
    const geometry = createWorldOrnaments(world)
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const [a, b, c] = Array.from(
        geometry.indices.slice(index, index + 3),
        (vertex) => position(geometry, vertex),
      )
      assert.ok(
        distanceToTriangle(
          a,
          b,
          c,
          world === 'tideweave' ? 0.89 : 1,
          world === 'tideweave' ? 1.08 : 1,
        ) > 0.9,
        `${world} covers the inner core`,
      )
    }
  }
})

await test('world identity is deterministic and returned geometry is caller-owned', () => {
  for (const world of ['glasswake', 'tideweave'] as const) {
    const first = createWorldOrnaments(world)
    const second = createWorldOrnaments(world)
    assert.deepEqual(first, second)
    first.vertices[0] = 99
    first.indices[0] = 99
    first.bounds.min[0] = 99
    assert.deepEqual(second, createWorldOrnaments(world))
  }
  assert.notDeepEqual(
    createWorldOrnaments('glasswake').vertices,
    createWorldOrnaments('tideweave').vertices,
  )
})
