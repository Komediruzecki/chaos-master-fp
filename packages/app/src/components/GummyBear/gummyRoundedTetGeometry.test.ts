/** Independent convex-geometry checks for the detached tetrahedron's inset-and-offset fillet. */
import { d, std } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { gummyRoundedTetPoint, gummySortedTetIds } from './gummyRoundedTet'

const vertices = [
  d.vec3f(1, 1, 1),
  d.vec3f(1, -1, -1),
  d.vec3f(-1, -1, 1),
  d.vec3f(-1, 1, -1),
] as const
const faces = [
  [1, 2, 3, 0],
  [0, 3, 2, 1],
  [0, 1, 3, 2],
  [0, 2, 1, 3],
] as const
const radius = 1 / Math.sqrt(3)
const physicalVolume = 8 / 3

function at(point: d.v3f) {
  return gummyRoundedTetPoint(...vertices, point, 16)
}

function expectVector(actual: d.v3f, expected: d.v3f, digits = 6) {
  for (let axis = 0; axis < 3; axis++)
    expect(actual[axis]).toBeCloseTo(expected[axis]!, digits)
}

function surface(subdivisions: number) {
  const triangles: ReturnType<typeof at>[][] = []
  for (const [ia, ib, ic] of faces) {
    const samples = new Map<string, ReturnType<typeof at>>()
    const sample = (row: number, column: number) => {
      const key = `${row}:${column}`
      let value = samples.get(key)
      if (!value) {
        const u = row / subdivisions,
          v = column / subdivisions
        value = at(
          std.add(
            std.add(std.mul(vertices[ia], 1 - u - v), std.mul(vertices[ib], u)),
            std.mul(vertices[ic], v),
          ),
        )
        samples.set(key, value)
      }
      return value
    }
    for (let row = 0; row < subdivisions; row++)
      for (let column = 0; column < subdivisions - row; column++) {
        triangles.push([
          sample(row, column),
          sample(row + 1, column),
          sample(row, column + 1),
        ])
        if (row + column < subdivisions - 1)
          triangles.push([
            sample(row + 1, column),
            sample(row + 1, column + 1),
            sample(row, column + 1),
          ])
      }
  }
  return triangles
}

function volume(triangles: ReturnType<typeof surface>) {
  return triangles.reduce(
    (sum, [a, b, c]) =>
      sum + std.dot(a!.position, std.cross(b!.position, c!.position)) / 6,
    0,
  )
}

describe('rounded detached tetrahedron geometry', () => {
  it('retains planar face centers while rounding true corners and edges inside the original tetrahedron', () => {
    const center = std.mul(vertices[0], -1 / 3)
    const face = at(center)
    expect(face.valid).toBe(1)
    expectVector(face.position, center)
    expectVector(face.normal, std.mul(vertices[0], -1 / Math.sqrt(3)))
    const corner = at(vertices[0])
    expectVector(corner.position, std.mul(vertices[0], 0.8))
    expectVector(corner.normal, std.normalize(vertices[0]))
    const edge = at(d.vec3f(1, 0, 0))
    expectVector(edge.position, d.vec3f(0.7 + 0.3 * radius, 0, 0))
    expectVector(edge.normal, d.vec3f(1, 0, 0))
    expect(edge.support).toBeCloseTo(radius, 6)
  })

  it('keeps every 8-by-8 rendered triangle outward-facing, finite and contained in physical material', () => {
    const triangles = surface(8)
    expect(triangles).toHaveLength(256)
    for (const [a, b, c] of triangles) {
      for (const point of [a!, b!, c!]) {
        expect(point.valid).toBe(1)
        expect(
          [...point.position, ...point.normal, ...point.bary].every(
            Number.isFinite,
          ),
        ).toBe(true)
        expect(std.length(point.normal)).toBeCloseTo(1, 6)
        expect(
          [...point.bary].reduce((sum, value) => sum + value, 0),
        ).toBeCloseTo(1, 6)
        for (const weight of point.bary)
          expect(weight).toBeGreaterThanOrEqual(-0.000001)
        // The four original support planes have inward normals equal to the opposite vertex.
        for (const inward of vertices)
          expect(std.dot(inward, point.position)).toBeGreaterThanOrEqual(
            -1.000001,
          )
      }
      const areaNormal = std.cross(
        std.sub(b!.position, a!.position),
        std.sub(c!.position, a!.position),
      )
      const normal = std.add(std.add(a!.normal, b!.normal), c!.normal)
      expect(std.dot(areaNormal, normal)).toBeGreaterThan(0)
    }
    // Steiner's formula for inner tetrahedron K offset by a ball of radius b.
    const b = 0.3 * radius,
      inset = 0.7
    const exactVolume =
      inset ** 3 * physicalVolume +
      inset ** 2 * 8 * Math.sqrt(3) * b +
      3 * inset * 2 * Math.sqrt(2) * Math.acos(-1 / 3) * b ** 2 +
      ((4 * Math.PI) / 3) * b ** 3
    expect(exactVolume).toBeCloseTo(2.452889731900921, 10)
    const renderedVolume = volume(triangles)
    expect(renderedVolume).toBeLessThan(exactVolume)
    expect(renderedVolume).toBeGreaterThan(exactVolume * 0.95)
    expect(renderedVolume).toBeLessThan(physicalVolume)
  })

  it('covers the rounded edge and corner normal cones rather than leaving gaps between faces', () => {
    for (const direction of [
      d.vec3f(1, 0, 0),
      std.normalize(d.vec3f(1, 0.2, 0.2)),
      std.normalize(d.vec3f(1, 1, 1)),
    ]) {
      // For the outer vertex normal cone, Q is the corresponding inner vertex.
      const inner = std.mul(vertices[0], 0.7)
      let travel = Infinity
      for (const inward of vertices) {
        const denominator = std.dot(inward, direction)
        if (denominator < 0)
          travel = Math.min(travel, (-1 - std.dot(inward, inner)) / denominator)
      }
      const originalBoundary = std.add(inner, std.mul(direction, travel))
      const expected = std.add(inner, std.mul(direction, 0.3 * radius))
      const result = at(originalBoundary)
      expect(result.valid).toBe(1)
      expectVector(result.position, expected)
    }
  })

  it('canonicalizes all face orderings so shared edge samples produce the same rounded position and dye coordinates', () => {
    const point = d.vec3f(1, 0.25, 0.25)
    const reference = at(point)
    for (const face of faces) {
      const sorted = gummySortedTetIds(
        d.vec4u(face[0], face[1], face[2], face[3]),
      )
      expect([...sorted]).toEqual([0, 1, 2, 3])
      const result = gummyRoundedTetPoint(
        vertices[sorted.x]!,
        vertices[sorted.y]!,
        vertices[sorted.z]!,
        vertices[sorted.w]!,
        point,
        16,
      )
      expect([...result.position]).toEqual([...reference.position])
      expect([...result.bary]).toEqual([...reference.bary])
    }
    expect([...gummySortedTetIds(d.vec4u(20, 8, 1024, 3))]).toEqual([
      3, 8, 20, 1024,
    ])
  })

  it('reconstructs rounded world positions and rest dye with the same tetrahedral material coordinates', () => {
    const transform = (p: d.v3f) =>
      d.vec3f(2 * p.x + 0.3 * p.y + 4, 0.7 * p.y - 2, 1.2 * p.z + 0.4 * p.x + 1)
    const deformed = vertices.map(transform)
    const point = transform(d.vec3f(1, 0.25, 0.25))
    const result = gummyRoundedTetPoint(
      deformed[0]!,
      deformed[1]!,
      deformed[2]!,
      deformed[3]!,
      point,
      16,
    )
    expect(result.valid).toBe(1)
    let rest = d.vec3f(0),
      world = d.vec3f(0)
    for (let i = 0; i < 4; i++) {
      rest = std.add(rest, std.mul(vertices[i]!, result.bary[i]!))
      world = std.add(world, std.mul(deformed[i]!, result.bary[i]!))
    }
    expectVector(world, result.position, 5)
    expectVector(transform(rest), result.position, 5)
    for (const weight of result.bary)
      expect(weight).toBeGreaterThanOrEqual(-0.000001)
  })

  it('returns a finite unchanged point for collapsed or orientation-reversing tetrahedra', () => {
    const point = d.vec3f(0.25, 0.25, 0)
    for (const q of [d.vec3f(0.25, 0.25, 0), d.vec3f(0, 0, -1)]) {
      const result = gummyRoundedTetPoint(
        d.vec3f(0),
        d.vec3f(1, 0, 0),
        d.vec3f(0, 1, 0),
        q,
        point,
        1,
      )
      expect(result.valid).toBe(0)
      expectVector(result.position, point)
      expect(
        [
          ...result.position,
          ...result.normal,
          ...result.bary,
          result.support,
        ].every(Number.isFinite),
      ).toBe(true)
    }
  })

  it('keeps anisotropic and thin fragments finite and contained, or safely preserves the original surface', () => {
    for (const height of [0.1, 0.01, 0.0001, 0.00000001]) {
      const a = d.vec3f(0),
        b = d.vec3f(1, 0, 0),
        c = d.vec3f(0.5, height, 0),
        q = d.vec3f(0, 0, 1)
      for (const point of [
        a,
        b,
        c,
        std.div(std.add(std.add(a, b), c), 3),
        std.mul(std.add(b, c), 0.5),
      ]) {
        const result = gummyRoundedTetPoint(a, b, c, q, point, height)
        expect(
          [
            ...result.position,
            ...result.normal,
            ...result.bary,
            result.support,
          ].every(Number.isFinite),
        ).toBe(true)
        if (result.valid === 0) {
          expectVector(result.position, point)
        } else {
          expect(result.valid).toBe(1)
          for (const weight of result.bary)
            expect(weight).toBeGreaterThanOrEqual(-0.00001)
          expect(
            [...result.bary].reduce((sum, weight) => sum + weight, 0),
          ).toBeCloseTo(1, 5)
          expect(std.length(result.normal)).toBeCloseTo(1, 5)
        }
        if (height < 0.0000001) expect(result.valid).toBe(0)
      }
    }
  })
})
