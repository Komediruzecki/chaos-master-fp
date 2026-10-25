/** Independent topology, mass and color checks for the bounded connected-solid rook study. */
import { describe, expect, it } from 'vitest'
import { sampleFlameFigurineCloud } from './flameFigurineCloud'
import { buildFractalChessFlame } from './fractalChessCollections'
import { assembledWindowRookPoints, buildWindowRookFracture, } from './windowRookFracture'
import { ROOK_SOLID_VERTEX_FLOATS } from './windowRookFractureMesh'
import { partitionWindowRook, windowRookVolume } from './windowRookVolume'

function sample(side: 'light' | 'dark' = 'light') {
  return sampleFlameFigurineCloud(
    buildFractalChessFlame('lattice-court', 'rook', side),
    { count: 24_000, seed: 42, lightness: 0.64 },
  )
}

function auditChunk(vertices: Float32Array) {
  const edges = new Map<string, number>()
  let volume = 0,
    outwardNormals = true
  for (
    let offset = 0;
    offset < vertices.length;
    offset += ROOK_SOLID_VERTEX_FLOATS * 3
  ) {
    const triangle = [0, 1, 2].map((vertex) =>
      Array.from(
        vertices.subarray(
          offset + vertex * ROOK_SOLID_VERTEX_FLOATS,
          offset + vertex * ROOK_SOLID_VERTEX_FLOATS + 3,
        ),
      ),
    )
    const [a, b, c] = triangle as [number[], number[], number[]]
    const ab = b.map((value, axis) => value - a[axis]!),
      ac = c.map((value, axis) => value - a[axis]!)
    const cross = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ]
    outwardNormals &&=
      cross.reduce(
        (sum, value, axis) => sum + value * vertices[offset + 3 + axis]!,
        0,
      ) > 0
    volume +=
      (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) +
        a[1]! * (b[2]! * c[0]! - b[0]! * c[2]!) +
        a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) /
      6
    const keys = triangle.map((point) =>
      point.map((value) => Math.round(value * 1e6)).join(','),
    )
    for (let edge = 0; edge < 3; edge++) {
      const from = keys[edge]!,
        to = keys[(edge + 1) % 3]!
      const key = [from, to].sort().join('|')
      edges.set(key, (edges.get(key) ?? 0) + (from < to ? 1 : -1))
    }
  }
  expect([...edges.values()].every((balance) => balance === 0)).toBe(true)
  expect(outwardNormals).toBe(true)
  return volume
}

describe('connected window-rook fracture', () => {
  it('partitions the actual native rook into 18 connected chunks without deleting cells or closing its large window', () => {
    const cloud = sample()
    const volume = windowRookVolume(cloud.points, cloud.colors)
    const { labels, count } = partitionWindowRook(volume.cells)
    expect(count).toBe(18)
    expect(labels.includes(-1)).toBe(false)
    for (let chunk = 0; chunk < count; chunk++) {
      const members = new Set(
        Array.from(labels, (label, index) =>
          label === chunk ? index : -1,
        ).filter((index) => index >= 0),
      )
      const queue = [members.values().next().value!],
        visited = new Set(queue)
      for (let cursor = 0; cursor < queue.length; cursor++)
        for (const next of volume.cells[queue[cursor]!]!.neighbours)
          if (members.has(next) && !visited.has(next)) {
            visited.add(next)
            queue.push(next)
          }
      expect(visited.size).toBe(members.size)
    }
    // The authored central through-window must remain empty throughout its depth.
    expect(
      volume.cells.filter(
        ({ position: p }) =>
          Math.abs(p[0]) < 0.12 && p[1] > 0.57 && p[1] < 0.88,
      ),
    ).toHaveLength(0)
    expect(volume.cells.length).toBeGreaterThan(2000)
    expect(volume.cells.length).toBeLessThan(30_000)
  })

  it('emits closed colored interiors and conserves the entire finite volume across all fragments', () => {
    const cloud = sample()
    const mesh = buildWindowRookFracture(
      'rook:light',
      cloud.points,
      cloud.colors,
    )
    expect(mesh.diagnostics.connectedComponents).toBe(1)
    expect(mesh.diagnostics.retainedFraction).toBe(1)
    expect(mesh.diagnostics.interfaceFaces % 2).toBe(0)
    expect(mesh.diagnostics.interfaceFaces).toBeGreaterThan(100)
    expect(mesh.vertices.length / ROOK_SOLID_VERTEX_FLOATS).toBeLessThanOrEqual(
      120_000,
    )
    expect(mesh.vertices.every(Number.isFinite)).toBe(true)
    const assembled = assembledWindowRookPoints([mesh])
    expect(assembled).toHaveLength(
      (mesh.vertices.length / ROOK_SOLID_VERTEX_FLOATS) * 4,
    )
    expect(
      assembled.every((value, offset) => {
        const axis = offset % 4
        if (axis === 3) return value === 1
        const vertex = Math.floor(offset / 4) * ROOK_SOLID_VERTEX_FLOATS
        const sum =
          mesh.vertices[vertex + axis]! + mesh.vertices[vertex + 9 + axis]!
        return value === Math.fround(axis === 1 ? Math.max(0, sum) : sum)
      }),
    ).toBe(true)
    let volume = 0,
      contained = true,
      unitNormals = true,
      validColors = true,
      coloredInteriors = true
    for (const chunk of mesh.chunks) {
      const start = chunk.firstVertex * ROOK_SOLID_VERTEX_FLOATS
      const vertices = mesh.vertices.subarray(
        start,
        start + chunk.vertexCount * ROOK_SOLID_VERTEX_FLOATS,
      )
      const chunkVolume = auditChunk(vertices)
      expect(chunkVolume).toBeCloseTo(
        chunk.cells * mesh.diagnostics.cellSize ** 3,
        6,
      )
      volume += chunkVolume
      for (
        let offset = 0;
        offset < vertices.length;
        offset += ROOK_SOLID_VERTEX_FLOATS
      ) {
        contained &&=
          Math.hypot(...vertices.subarray(offset, offset + 3)) <=
          chunk.radius + 1e-6
        unitNormals &&=
          Math.hypot(...vertices.subarray(offset + 3, offset + 6)) === 1
        const color = Array.from(vertices.subarray(offset + 6, offset + 9))
        validColors &&= color.every((value) => value >= 0 && value <= 1)
        coloredInteriors &&= Math.max(...color) - Math.min(...color) > 0.03
      }
    }
    expect(volume).toBeCloseTo(mesh.diagnostics.volume, 6)
    expect({ contained, unitNormals, validColors, coloredInteriors }).toEqual({
      contained: true,
      unitNormals: true,
      validColors: true,
      coloredInteriors: true,
    })
  })

  it('replays the same mesh exactly and changes only color when sides change', () => {
    const light = sample(),
      dark = sample('dark')
    const a = buildWindowRookFracture('rook:light', light.points, light.colors)
    const b = buildWindowRookFracture('rook:light', light.points, light.colors)
    const c = buildWindowRookFracture('rook:dark', dark.points, dark.colors)
    expect(
      a.vertices.every((value, index) => value === b.vertices[index]),
    ).toBe(true)
    expect(a.diagnostics).toEqual(c.diagnostics)
    expect(a.vertices.length).toBe(c.vertices.length)
    let colorDifference = false,
      geometryDifference = false
    for (let offset = 0; offset < a.vertices.length; offset++)
      if (
        offset % ROOK_SOLID_VERTEX_FLOATS >= 6 &&
        offset % ROOK_SOLID_VERTEX_FLOATS < 9
      )
        colorDifference ||= a.vertices[offset] !== c.vertices[offset]
      else geometryDifference ||= a.vertices[offset] !== c.vertices[offset]
    expect(colorDifference).toBe(true)
    expect(geometryDifference).toBe(false)
  })

  it('rejects malformed arrays, out-of-range colors and disconnected mass instead of silently bridging or dropping it', () => {
    expect(() =>
      buildWindowRookFracture(
        'pawn:light',
        new Float32Array(),
        new Float32Array(),
      ),
    ).toThrow('window rooks')
    expect(() =>
      windowRookVolume(new Float32Array([0, 1, 0, 1]), new Float32Array(0)),
    ).toThrow('matching')
    expect(() =>
      windowRookVolume(
        new Float32Array([0, 1, NaN, 1]),
        new Float32Array([0.1, 0.2, 0.3, 1]),
      ),
    ).toThrow('finite')
    expect(() =>
      windowRookVolume(
        new Float32Array([0, 1, 0, 1]),
        new Float32Array([0.1, 2, 0.3, 1]),
      ),
    ).toThrow('[0,1]')
    expect(() =>
      partitionWindowRook(
        [
          { position: [0, 0, 0], color: [0, 0, 0], neighbours: [] },
          { position: [1, 1, 1], color: [0, 0, 0], neighbours: [] },
        ],
        2,
      ),
    ).toThrow('disconnected')
  })
})
