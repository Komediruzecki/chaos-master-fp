/** Audit real fitted glass facets for containment, closed topology and correct optical normals. */
import { describe, expect, it } from 'vitest'
import { sampleFlameFigurineCloud } from './flameFigurineCloud'
import { buildFractalChessFlame } from './fractalChessCollections'
import { buildFractalStudyGlass, getFractalStudyGlassRole, } from './fractalStudyGlass'

type Point = readonly [number, number, number]
type Triangle = readonly [Point, Point, Point]

function trianglesOf(vertices: Float32Array): Triangle[] {
  const result: Triangle[] = []
  for (let offset = 0; offset < vertices.length; offset += 18)
    result.push(
      [0, 6, 12].map((start) =>
        Array.from(vertices.subarray(offset + start, offset + start + 3)),
      ) as unknown as Triangle,
    )
  return result
}

function auditSurface(vertices: Float32Array) {
  const edges = new Map<string, number>()
  let volume = 0
  const triangles = trianglesOf(vertices)
  for (let index = 0; index < triangles.length; index++) {
    const [a, b, c] = triangles[index]!
    const ab = b.map((value, axis) => value - a[axis]!)
    const ac = c.map((value, axis) => value - a[axis]!)
    const cross = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ]
    expect(Math.hypot(...cross)).toBeGreaterThan(1e-9)
    for (const start of [0, 6, 12]) {
      const normal = Array.from(
        vertices.subarray(index * 18 + start + 3, index * 18 + start + 6),
      )
      expect(Math.hypot(...normal)).toBeCloseTo(1, 5)
      expect(
        normal.reduce((sum, value, axis) => sum + value * cross[axis]!, 0),
      ).toBeGreaterThan(0)
    }
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6
    const keys = [a, b, c].map((point) =>
      point.map((value) => Math.round(value * 1e6)).join(','),
    )
    for (let edge = 0; edge < 3; edge++) {
      const key = [keys[edge]!, keys[(edge + 1) % 3]!].sort().join('|')
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  expect([...edges.values()].every((count) => count === 2)).toBe(true)
  return volume
}

/** Independent ray/triangle containment against the emitted inward mesh. */
function cavityProbe(vertices: Float32Array) {
  const triangles = trianglesOf(vertices)
  const minY = Math.min(
    ...triangles.flatMap((triangle) => triangle.map((point) => point[1])),
  )
  const maxY = Math.max(
    ...triangles.flatMap((triangle) => triangle.map((point) => point[1])),
  )
  const bin = (y: number) =>
    Math.max(0, Math.min(63, Math.floor(((y - minY) / (maxY - minY)) * 64)))
  const bins: Triangle[][] = Array.from({ length: 64 }, () => [])
  for (const triangle of triangles) {
    const low = bin(Math.min(...triangle.map((point) => point[1])))
    const high = bin(Math.max(...triangle.map((point) => point[1])))
    for (let index = low; index <= high; index++) bins[index]!.push(triangle)
  }
  return ([x, y, z]: Point) => {
    if (y <= minY || y >= maxY) return false
    const hits = new Set<number>()
    for (const [a, b, c] of bins[bin(y)]!) {
      const by = b[1] - a[1],
        bz = b[2] - a[2]
      const cy = c[1] - a[1],
        cz = c[2] - a[2]
      const determinant = by * cz - bz * cy
      if (Math.abs(determinant) < 1e-12) continue
      const u = ((y - a[1]) * cz - (z - a[2]) * cy) / determinant
      const v = (by * (z - a[2]) - bz * (y - a[1])) / determinant
      if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue
      const hit = a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0])
      if (hit > x) hits.add(Math.round(hit * 1e6))
    }
    return hits.size % 2 === 1
  }
}

describe('glass envelopes for the three native fractal studies', () => {
  it('only maps the requested favourites to their glass role', () => {
    expect(getFractalStudyGlassRole('wild-canopy')).toBe('knight')
    expect(getFractalStudyGlassRole('tidal-relics')).toBe('bishop')
    expect(getFractalStudyGlassRole('lattice-court')).toBe('rook')
    expect(getFractalStudyGlassRole('missing')).toBeUndefined()
  })

  it.each(['wild-canopy', 'tidal-relics', 'lattice-court'])(
    '%s encloses every supplied point in a thin, closed and smoothly shaded cavity',
    (collection) => {
      const role = getFractalStudyGlassRole(collection)!
      const flame = buildFractalChessFlame(collection, role)
      const points = sampleFlameFigurineCloud(flame, {
        count: 6000,
        seed: 837,
      }).points
      const original = points.slice()
      const mesh = buildFractalStudyGlass(collection, points)
      expect(points).toEqual(original)
      expect(mesh.vertices.every(Number.isFinite)).toBe(true)
      expect(mesh.vertices.length / 18).toBeLessThan(5000)
      const outer = mesh.vertices.subarray(0, mesh.vertices.length / 2)
      const inner = mesh.vertices.subarray(mesh.vertices.length / 2)
      const outerVolume = auditSurface(outer)
      const innerVolume = auditSurface(inner)
      expect(outerVolume).toBeGreaterThan(0)
      expect(innerVolume).toBeLessThan(0)
      expect(outerVolume + innerVolume).toBeGreaterThan(0)
      expect((outerVolume + innerVolume) / outerVolume).toBeLessThan(0.35)
      const inside = cavityProbe(inner)
      for (let offset = 0; offset < points.length; offset += 4)
        expect(
          inside([points[offset]!, points[offset + 1]!, points[offset + 2]!]),
          `escaped sample ${offset / 4}`,
        ).toBe(true)
      expect(inside([mesh.radius * 2, 1, 0])).toBe(false)
      expect(inside([0, 20, 0])).toBe(false)
      let radius = 0
      for (let offset = 0; offset < mesh.vertices.length; offset += 6)
        radius = Math.max(
          radius,
          Math.hypot(mesh.vertices[offset]!, mesh.vertices[offset + 2]!),
        )
      expect(mesh.radius).toBe(radius)
    },
  )

  it('fits thin edge and corner samples without treating the ideal rounded profile as the mesh', () => {
    const points = new Float32Array([
      -0.63, 0.05, -0.13, 1, 0.63, 0.05, 0.13, 1, -0.63, 1.55, 0.13, 1, 0.63,
      1.55, -0.13, 1, 0.64, 0.79, 0.13, 1, -0.64, 0.82, -0.13, 1,
    ])
    const mesh = buildFractalStudyGlass('lattice-court', points)
    const inside = cavityProbe(mesh.vertices.subarray(mesh.vertices.length / 2))
    for (let offset = 0; offset < points.length; offset += 4)
      expect(
        inside([points[offset]!, points[offset + 1]!, points[offset + 2]!]),
      ).toBe(true)
  })

  it.each(['wild-canopy', 'tidal-relics', 'lattice-court'])(
    '%s keeps the production glass footprint inside its own board square',
    (collection) => {
      const role = getFractalStudyGlassRole(collection)!
      const points = sampleFlameFigurineCloud(
        buildFractalChessFlame(collection, role),
        { count: 60_000, seed: 42 },
      ).points
      const mesh = buildFractalStudyGlass(collection, points)
      const coreExtents = [0, 0, 0]
      const glassExtents = [0, 0, 0]
      for (let offset = 0; offset < points.length; offset += 4)
        for (const axis of [0, 2])
          coreExtents[axis] = Math.max(
            coreExtents[axis]!,
            Math.abs(points[offset + axis]!),
          )
      for (let offset = 0; offset < mesh.vertices.length; offset += 6)
        for (const axis of [0, 2])
          glassExtents[axis] = Math.max(
            glassExtents[axis]!,
            Math.abs(mesh.vertices[offset + axis]!),
          )
      // The actual board places unmodified clouds and shells at scale .9 in
      // a 1.6-unit tile. Test each axis, not the circumscribed circle's corners.
      for (const axis of [0, 2]) {
        expect(coreExtents[axis]! * 0.9).toBeLessThan(0.8)
        expect(
          glassExtents[axis]! * 0.9,
          `axis ${axis}: core ${coreExtents[axis]}, glass ${glassExtents[axis]}`,
        ).toBeLessThan(0.8)
      }
      expect(glassExtents[0]! / coreExtents[0]!).toBeLessThan(1.5)
    },
  )

  it('rejects malformed or unknown inputs before creating broken GPU vertices', () => {
    expect(() =>
      buildFractalStudyGlass('missing', new Float32Array([0, 0, 0, 1])),
    ).toThrow('Unknown')
    for (const points of [
      new Float32Array(),
      new Float32Array([1, 2, 3]),
      new Float32Array([NaN, 0, 0, 1]),
    ])
      expect(() => buildFractalStudyGlass('wild-canopy', points)).toThrow(
        RangeError,
      )
  })
})
