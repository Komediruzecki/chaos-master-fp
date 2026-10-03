/** Actual closed geometry, outward normals, cavity clearance, and reproducible fracture. */
import { describe, expect, it } from 'vitest'
import { buildPawnShellFragments, buildPawnShellGeometry, isPointInsidePawnShellCavity, PAWN_SHELL_FLOOR, PAWN_SHELL_TOP, } from './pawnBoardGeometry'
import { samplePawnCloud } from './pawnCloud'
import { buildPawnFlame } from './pawnFlame'
import { buildStructuralPawnFlame } from './structuralPawnFlame'

function vertexKey(
  vertices: Float32Array,
  offset: number,
  translation = [0, 0, 0],
) {
  return [0, 1, 2]
    .map((axis) =>
      Math.round((vertices[offset + axis]! + translation[axis]!) * 100_000),
    )
    .join(',')
}

function audit(vertices: Float32Array) {
  const edges = new Map<string, number>()
  let volume = 0
  for (let offset = 0; offset < vertices.length; offset += 18) {
    const p = [0, 6, 12].map((start) =>
      [0, 1, 2].map((axis) => vertices[offset + start + axis]!),
    )
    const a = p[0]!,
      b = p[1]!,
      c = p[2]!
    const ab = b.map((value, axis) => value - a[axis]!)
    const ac = c.map((value, axis) => value - a[axis]!)
    const cross = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ]
    expect(Math.hypot(...cross)).toBeGreaterThan(1e-10)
    for (const start of [0, 6, 12]) {
      const normal = [0, 1, 2].map(
        (axis) => vertices[offset + start + 3 + axis]!,
      )
      expect(Math.hypot(...normal)).toBeCloseTo(1, 5)
      expect(
        normal.reduce((sum, value, axis) => sum + value * cross[axis]!, 0),
      ).toBeGreaterThan(0)
    }
    volume +=
      (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) +
        a[1]! * (b[2]! * c[0]! - b[0]! * c[2]!) +
        a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) /
      6
    const keys = [0, 6, 12].map((start) => vertexKey(vertices, offset + start))
    for (let edge = 0; edge < 3; edge++) {
      const from = keys[edge]!,
        to = keys[(edge + 1) % 3]!
      const key = [from, to].sort().join('|')
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  expect([...edges.values()].every((count) => count === 2)).toBe(true)
  return volume
}

describe('pawn glass geometry', () => {
  it('opts into unit outward smooth normals without changing a single triangle position', () => {
    const flat = buildPawnShellGeometry({ radialSegments: 24 })
    expect(flat.vertices).toEqual(
      buildPawnShellGeometry({ radialSegments: 24, smoothNormals: false })
        .vertices,
    )
    const smooth = buildPawnShellGeometry({
      radialSegments: 24,
      smoothNormals: true,
    })
    expect(audit(smooth.vertices)).toBeGreaterThan(0)
    expect(smooth.vertices.length).toBe(flat.vertices.length)
    let changed = 0
    for (let offset = 0; offset < flat.vertices.length; offset += 6) {
      expect(Array.from(smooth.vertices.subarray(offset, offset + 3))).toEqual(
        Array.from(flat.vertices.subarray(offset, offset + 3)),
      )
      if (
        smooth.vertices
          .subarray(offset + 3, offset + 6)
          .some(
            (value, n) =>
              Math.abs(value - flat.vertices[offset + 3 + n]!) > 1e-6,
          )
      )
        changed++
    }
    expect(changed).toBeGreaterThan(flat.vertices.length / 12)
  })

  it('smooths the crown and radial seam into axial poles while retaining the sharp foot crease', () => {
    const vertices = buildPawnShellGeometry({ smoothNormals: true }).vertices
    const normalsAt = (x: number, y: number, z: number) => {
      const normals: number[][] = []
      for (let offset = 0; offset < vertices.length; offset += 6)
        if (
          Math.abs(vertices[offset]! - x) < 1e-6 &&
          Math.abs(vertices[offset + 1]! - y) < 1e-6 &&
          Math.abs(vertices[offset + 2]! - z) < 1e-6
        )
          normals.push(Array.from(vertices.subarray(offset + 3, offset + 6)))
      expect(normals.length).toBeGreaterThan(1)
      return normals
    }
    const equator = normalsAt(0.39, 1.47, 0)
    for (const normal of equator) {
      expect(normal[0]).toBeCloseTo(1, 6)
      expect(normal[1]).toBeCloseTo(0, 6)
      expect(normal[2]).toBeCloseTo(0, 6)
    }
    for (const normal of normalsAt(0, PAWN_SHELL_TOP, 0))
      expect(normal).toEqual([0, 1, 0])
    for (const normal of normalsAt(0, 1.835, 0)) {
      expect(normal[0]).toBe(0)
      expect(normal[1]).toBe(-1)
      expect(normal[2]).toBe(0)
    }
    const foot = normalsAt(0.67, PAWN_SHELL_FLOOR, 0)
    expect(foot.some((normal) => normal[1] === -1 && normal[0] === 0)).toBe(
      true,
    )
    expect(foot.some((normal) => normal[0] === 1 && normal[1] === 0)).toBe(true)
    expect(
      new Set(
        foot.map((normal) =>
          normal.map((value) => Math.round(value * 1e6)).join(','),
        ),
      ).size,
    ).toBe(2)
  })

  it('matches smooth intact normals on resting shards, preserving flat normals on every new cut', () => {
    const options = { radialSegments: 24, smoothNormals: true }
    const surface = buildPawnShellGeometry(options).vertices
    const triangles = new Set<string>()
    const surfaceVertices = new Set<string>()
    const triangleKey = (
      vertices: Float32Array,
      offset: number,
      translation = [0, 0, 0],
    ) =>
      [0, 6, 12]
        .map((start) => vertexKey(vertices, offset + start, translation))
        .sort()
        .join('|')
    const normalKey = (vertices: Float32Array, offset: number) =>
      Array.from(vertices.subarray(offset + 3, offset + 6))
        .map((value) => Math.round(value * 100_000))
        .join(',')
    for (let offset = 0; offset < surface.length; offset += 18) {
      triangles.add(triangleKey(surface, offset))
      for (const start of [0, 6, 12])
        surfaceVertices.add(
          `${vertexKey(surface, offset + start)}|${normalKey(surface, offset + start)}`,
        )
    }
    let intactTriangles = 0
    let cuts = 0
    for (const fragment of buildPawnShellFragments(options)) {
      const translation = [...fragment.centroid]
      for (let offset = 0; offset < fragment.vertices.length; offset += 18) {
        if (
          triangles.has(triangleKey(fragment.vertices, offset, translation))
        ) {
          intactTriangles++
          for (const start of [0, 6, 12])
            expect(
              surfaceVertices.has(
                `${vertexKey(fragment.vertices, offset + start, translation)}|${normalKey(fragment.vertices, offset + start)}`,
              ),
            ).toBe(true)
        } else {
          cuts++
          expect(normalKey(fragment.vertices, offset)).toBe(
            normalKey(fragment.vertices, offset + 6),
          )
          expect(normalKey(fragment.vertices, offset)).toBe(
            normalKey(fragment.vertices, offset + 12),
          )
        }
      }
    }
    expect(intactTriangles).toBe(surface.length / 18)
    expect(cuts).toBeGreaterThan(intactTriangles)
  })

  it('makes an actual closed hollow pawn with valid normals and finite floor/top', () => {
    const mesh = buildPawnShellGeometry()
    expect(mesh.vertices.length % 18).toBe(0)
    expect(audit(mesh.vertices)).toBeGreaterThan(0)
    const y = Array.from(mesh.vertices).filter(
      (_value, index) => index % 6 === 1,
    )
    expect(Math.min(...y)).toBeCloseTo(PAWN_SHELL_FLOOR, 6)
    expect(Math.max(...y)).toBeCloseTo(PAWN_SHELL_TOP, 6)
  })

  it('splits the same envelope into 800 distinct closed solid shards with seeded motion', () => {
    const fragments = buildPawnShellFragments({ seed: 14 })
    expect(fragments).toHaveLength(800)
    expect(fragments).toEqual(buildPawnShellFragments({ seed: 14 }))
    expect(fragments[0]!.velocity).not.toEqual(
      buildPawnShellFragments({ seed: 15 })[0]!.velocity,
    )
    expect(
      new Set(fragments.map((fragment) => fragment.centroid.join(','))).size,
    ).toBe(800)
    const volumes = fragments.map((fragment) => audit(fragment.vertices))
    expect(volumes.every((volume) => volume > 0)).toBe(true)
    expect(volumes.reduce((sum, volume) => sum + volume, 0)).toBeCloseTo(
      audit(buildPawnShellGeometry().vertices),
      5,
    )
  })

  it('retains every intact surface triangle when fragments are reassembled at their centroids', () => {
    const triangles = new Set<string>()
    for (const fragment of buildPawnShellFragments()) {
      for (let offset = 0; offset < fragment.vertices.length; offset += 18)
        triangles.add(
          [0, 6, 12]
            .map((start) =>
              vertexKey(fragment.vertices, offset + start, [
                ...fragment.centroid,
              ]),
            )
            .sort()
            .join('|'),
        )
    }
    const intact = buildPawnShellGeometry().vertices
    for (let offset = 0; offset < intact.length; offset += 18)
      expect(
        triangles.has(
          [0, 6, 12]
            .map((start) => vertexKey(intact, offset + start))
            .sort()
            .join('|'),
        ),
      ).toBe(true)
  })

  it.each([buildPawnFlame, buildStructuralPawnFlame])(
    'encloses native point samples at both control extremes',
    (build) => {
      for (const openness of [0, 1]) {
        const cloud = samplePawnCloud(
          build({ openness, branchCount: 8, twist: Math.PI }),
          { count: 4096, seed: 7 },
        )
        for (let n = 0; n < cloud.count; n++)
          expect(
            isPointInsidePawnShellCavity([
              cloud.points[n * 4]!,
              cloud.points[n * 4 + 1]!,
              cloud.points[n * 4 + 2]!,
            ]),
          ).toBe(true)
      }
      expect(isPointInsidePawnShellCavity([1, 1, 0])).toBe(false)
      expect(isPointInsidePawnShellCavity([0, PAWN_SHELL_TOP, 0])).toBe(false)
    },
  )
})
