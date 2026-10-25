/**
 * Interpret the authored native maps independently: prove Euclidean contraction,
 * local component bounds, recursive deleted cells and distinct chess silhouettes.
 * Finite clouds come from the production baker rather than a parallel sampler.
 */
import { describe, expect, it } from 'vitest'
import { validateFlame3D } from '../schema/flameSchema'
import { buildFigurineStudy, FIGURINE_STUDIES } from './figurineStudies'
import { samplePawnCloud } from './pawnCloud'
import { buildStructuralPawnFlame } from './structuralPawnFlame'
import type { AffineParams3D } from '@chaos-master/core'
import type { FlameDescriptor3D, TransformId } from '../schema/flameSchema'
import type { FigurineStudyId } from './figurineStudies'

type Point = readonly [number, number, number]
type NativeMap = FlameDescriptor3D['transforms'][TransformId]
const NEW_IDS: FigurineStudyId[] = [
  'menger-rook',
  'sierpinski-bishop',
  'branching-knight',
]

function apply(m: AffineParams3D, p: Point): Point {
  return [
    m.a * p[0] + m.b * p[1] + m.c * p[2] + m.d,
    m.e * p[0] + m.f * p[1] + m.g * p[2] + m.h,
    m.i * p[0] + m.j * p[1] + m.k * p[2] + m.l,
  ]
}

function mapsFor(flame: FlameDescriptor3D, group: string): NativeMap[] {
  return Object.values(flame.transforms).filter(
    (map) => map.walkGroup === group,
  )
}

function corner(map: NativeMap): Point {
  const m = map.postAffine
  return [m.d / (1 - m.a), m.h / (1 - m.f), m.l / (1 - m.k)]
}

function cornersOfBox(min: Point, max: Point): Point[] {
  const corners: Point[] = []
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) corners.push([x, y, z])
  return corners
}

/** sqrt(||A^T A||_infinity) is a genuine upper bound on the largest singular value. */
function contractionBound(m: AffineParams3D): number {
  const columns = [
    [m.a, m.e, m.i],
    [m.b, m.f, m.j],
    [m.c, m.g, m.k],
  ]
  const gram = columns.map((column) =>
    columns.map((other) =>
      column.reduce((sum, value, axis) => sum + value * other[axis]!, 0),
    ),
  )
  return Math.sqrt(
    Math.max(
      ...gram.map((row) =>
        row.reduce((sum, value) => sum + Math.abs(value), 0),
      ),
    ),
  )
}

function bounds(points: readonly Point[]): { min: Point; max: Point } {
  return {
    min: [0, 1, 2].map((axis) =>
      Math.min(...points.map((p) => p[axis]!)),
    ) as unknown as Point,
    max: [0, 1, 2].map((axis) =>
      Math.max(...points.map((p) => p[axis]!)),
    ) as unknown as Point,
  }
}

function sampledGroup(
  flame: FlameDescriptor3D,
  group: string,
  count = 4096,
): Point[] {
  const transforms = Object.fromEntries(
    Object.entries(flame.transforms).filter(
      ([, map]) => map.walkGroup === group,
    ),
  )
  const cloud = samplePawnCloud(
    { ...flame, transforms },
    { count, seed: 715, burnIn: 96 },
  )
  const points: Point[] = []
  for (let n = 0; n < count; n++)
    points.push([
      cloud.points[n * 4]!,
      cloud.points[n * 4 + 1]!,
      cloud.points[n * 4 + 2]!,
    ])
  return points
}

const sub = (a: Point, b: Point): Point => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

function barycentric(point: Point, vertices: Point[]): number[] {
  const a = sub(vertices[1]!, vertices[0]!),
    b = sub(vertices[2]!, vertices[0]!),
    c = sub(vertices[3]!, vertices[0]!)
  const delta = sub(point, vertices[0]!),
    determinant = dot(a, cross(b, c))
  const x = dot(delta, cross(b, c)) / determinant
  const y = dot(a, cross(delta, c)) / determinant
  const z = dot(a, cross(b, delta)) / determinant
  return [1 - x - y - z, x, y, z]
}

describe('native figurine studies', () => {
  it('preserves the existing lattice pawn and advertises four distinct comparisons', () => {
    expect(FIGURINE_STUDIES.map((study) => study.id)).toEqual([
      'lattice-pawn',
      ...NEW_IDS,
    ])
    expect(new Set(FIGURINE_STUDIES.map((study) => study.family)).size).toBe(4)
    expect(buildFigurineStudy('lattice-pawn')).toEqual(
      buildStructuralPawnFlame(),
    )
    expect(buildFigurineStudy('lattice-pawn', 'dark')).toEqual(
      buildStructuralPawnFlame({ side: 'dark' }),
    )
  })

  it.each(NEW_IDS)(
    '%s persists only grouped contractive native affine geometry',
    (id) => {
      const flame = validateFlame3D(buildFigurineStudy(id))
      const maps = Object.values(flame.transforms)
      expect(maps.length).toBeLessThanOrEqual(128)
      expect(
        new Set(maps.map((map) => map.walkGroup)).size,
      ).toBeGreaterThanOrEqual(6)
      expect(maps.reduce((sum, map) => sum + map.probability, 0)).toBeCloseTo(
        1,
        12,
      )
      for (const map of maps) {
        expect(map.walkGroup).toBeTruthy()
        expect(map.probability).toBeGreaterThan(0)
        expect(
          Object.values(map.variations).map((v) => [
            v.type,
            v.weight,
            v.visible,
          ]),
        ).toEqual([['linear3D', 1, true]])
        expect(map.preAffine).toEqual({
          a: 1,
          b: 0,
          c: 0,
          d: 0,
          e: 0,
          f: 1,
          g: 0,
          h: 0,
          i: 0,
          j: 0,
          k: 1,
          l: 0,
        })
        expect(contractionBound(map.postAffine)).toBeLessThan(0.8)
      }
      expect(validateFlame3D(JSON.parse(JSON.stringify(flame)))).toEqual(flame)
      const dark = validateFlame3D(buildFigurineStudy(id, 'dark'))
      for (const [key, map] of Object.entries(flame.transforms)) {
        expect(dark.transforms[key as TransformId]!.postAffine).toEqual(
          map.postAffine,
        )
        expect(dark.transforms[key as TransformId]!.color).not.toEqual(
          map.color,
        )
      }
      const same = buildFigurineStudy(id)
      expect(same).toEqual(flame)
      expect(same.transforms).not.toBe(flame.transforms)
    },
  )

  it.each(NEW_IDS)(
    '%s settles deterministically into a grounded human-scale volume',
    (id) => {
      const flame = buildFigurineStudy(id)
      const first = samplePawnCloud(flame, {
        count: 12000,
        seed: 47,
        burnIn: 96,
      })
      const second = samplePawnCloud(flame, {
        count: 12000,
        seed: 47,
        burnIn: 96,
      })
      expect(first.points).toEqual(second.points)
      expect(first.bounds.min[1]).toBeGreaterThanOrEqual(-1e-6)
      expect(first.bounds.min[1]).toBeLessThan(0.005)
      expect(first.bounds.max[1]).toBeGreaterThan(1.76)
      expect(first.bounds.max[1]).toBeLessThanOrEqual(1.8 + 1e-6)
      expect(first.bounds.max[0] - first.bounds.min[0]).toBeGreaterThan(1)
      expect(first.bounds.max[2] - first.bounds.min[2]).toBeGreaterThan(0.9)
      expect(first.bounds.min[0]).toBeGreaterThanOrEqual(-0.640001)
      expect(first.bounds.max[0]).toBeLessThanOrEqual(0.740001)
    },
  )

  it('keeps every corner-based component inside the convex box of its own fixed points', () => {
    for (const id of NEW_IDS) {
      const flame = validateFlame3D(buildFigurineStudy(id))
      const groups = new Set(
        Object.values(flame.transforms).map((map) => map.walkGroup!),
      )
      for (const group of groups) {
        if (group === 'knight_neck') continue
        const maps = mapsFor(flame, group),
          box = bounds(maps.map(corner))
        for (const map of maps)
          for (const p of cornersOfBox(box.min, box.max)) {
            const q = apply(map.postAffine, p)
            for (let axis = 0; axis < 3; axis++) {
              expect(q[axis]!).toBeGreaterThanOrEqual(box.min[axis]! - 1e-12)
              expect(q[axis]!).toBeLessThanOrEqual(box.max[axis]! + 1e-12)
            }
          }
      }
    }
  })

  it('retains Menger cavities at four address levels through tower, crown and pedestal', () => {
    const flame = validateFlame3D(buildFigurineStudy('menger-rook'))
    for (const group of ['rook_foot', 'rook_tower', 'rook_crown']) {
      const maps = mapsFor(flame, group),
        box = bounds(maps.map(corner))
      expect(maps).toHaveLength(20)
      for (const point of sampledGroup(flame, group)) {
        let coordinates = [0, 1, 2].map(
          (axis) =>
            (point[axis]! - box.min[axis]!) / (box.max[axis]! - box.min[axis]!),
        )
        for (let level = 0; level < 4; level++) {
          const scaled = coordinates.map(
            (value) => Math.max(0, Math.min(1 - 1e-7, value)) * 3,
          )
          const digits = scaled.map(Math.floor)
          // Float32 rounding can move boundary points into an adjacent closed cell.
          const boundary = scaled.some(
            (value) => Math.abs(value - Math.round(value)) < 0.0001,
          )
          if (!boundary)
            expect(digits.filter((digit) => digit === 1).length).toBeLessThan(2)
          coordinates = scaled.map((value, axis) => value - digits[axis]!)
        }
      }
    }
  })

  it('preserves tetrahedral central gaps at four scales in the bishop mitre and stem', () => {
    const flame = validateFlame3D(buildFigurineStudy('sierpinski-bishop'))
    for (const group of ['bishop_mitre', 'bishop_stem']) {
      const maps = mapsFor(flame, group),
        vertices = maps.map(corner)
      expect(vertices).toHaveLength(4)
      expect(
        Math.abs(
          dot(
            sub(vertices[1]!, vertices[0]!),
            cross(
              sub(vertices[2]!, vertices[0]!),
              sub(vertices[3]!, vertices[0]!),
            ),
          ),
        ),
      ).toBeGreaterThan(0.05)
      for (const point of sampledGroup(flame, group)) {
        let weights = barycentric(point, vertices)
        for (let level = 0; level < 4; level++) {
          expect(Math.min(...weights)).toBeGreaterThan(-0.00002)
          const chosen = weights.indexOf(Math.max(...weights))
          expect(weights[chosen]!).toBeGreaterThanOrEqual(0.5 - 0.00002)
          weights = weights.map(
            (weight, axis) => (weight - (axis === chosen ? 0.5 : 0)) * 2,
          )
        }
      }
    }
  })

  it('makes a genuinely 3D leaning branch neck with an invariant local domain', () => {
    const flame = validateFlame3D(buildFigurineStudy('branching-knight'))
    const maps = mapsFor(flame, 'knight_neck')
    const toWorld = ([x, y, z]: Point): Point => [
      0.38 * x + 0.32 * y - 0.17,
      1.1 * y + 0.18,
      0.28 * z,
    ]
    const toLocal = ([x, y, z]: Point): Point => {
      const yy = (y - 0.18) / 1.1
      return [(x + 0.17 - 0.32 * yy) / 0.38, yy, z / 0.28]
    }
    expect(maps).toHaveLength(6)
    expect(maps.filter((map) => Math.abs(map.postAffine.e) > 0.4)).toHaveLength(
      4,
    )
    for (const map of maps)
      for (const p of cornersOfBox([-1, 0, -1], [1, 1, 1])) {
        const q = toLocal(apply(map.postAffine, toWorld(p)))
        expect(Math.abs(q[0])).toBeLessThanOrEqual(1 + 1e-12)
        expect(q[1]).toBeGreaterThanOrEqual(-1e-12)
        expect(q[1]).toBeLessThanOrEqual(1 + 1e-12)
        expect(Math.abs(q[2])).toBeLessThanOrEqual(1 + 1e-12)
      }
    const neck = bounds(sampledGroup(flame, 'knight_neck'))
    expect(neck.max[0] - neck.min[0]).toBeGreaterThan(0.35)
    expect(neck.max[2] - neck.min[2]).toBeGreaterThan(0.18)
    expect(neck.max[1] - neck.min[1]).toBeGreaterThan(0.8)
    const muzzle = bounds(sampledGroup(flame, 'knight_muzzle'))
    expect(muzzle.min[0]).toBeGreaterThan(0.27)
    expect(muzzle.max[0]).toBeGreaterThan(0.73)
  })

  it('aligns components at exact attractor points rather than just overlapping hulls', () => {
    const near = (a: Point, b: Point) => Math.hypot(...sub(a, b)) < 1e-12
    const hasFixedPoint = (maps: NativeMap[], point: Point) =>
      maps.some((map) => near(apply(map.postAffine, point), point))
    const bishop = validateFlame3D(buildFigurineStudy('sierpinski-bishop'))
    for (const group of ['bishop_foot_0', 'bishop_stem'])
      expect(hasFixedPoint(mapsFor(bishop, group), [0, 0.22, 0])).toBe(true)
    for (const group of ['bishop_stem', 'bishop_collar', 'bishop_mitre'])
      expect(hasFixedPoint(mapsFor(bishop, group), [0, 1.13, 0])).toBe(true)

    const knight = validateFlame3D(buildFigurineStudy('branching-knight'))
    for (const group of ['knight_foot', 'knight_neck'])
      expect(hasFixedPoint(mapsFor(knight, group), [-0.17, 0.18, 0])).toBe(true)
    for (const group of ['knight_neck', 'knight_head'])
      expect(hasFixedPoint(mapsFor(knight, group), [0.15, 1.28, 0])).toBe(true)
    for (const group of ['knight_head', 'knight_muzzle'])
      expect(hasFixedPoint(mapsFor(knight, group), [0.42, 1.44, 0])).toBe(true)
    const head = mapsFor(knight, 'knight_head')
    const top = head.find((map) => near(corner(map), [0.19, 1.68, 0]))!
    for (const side of [-1, 1]) {
      const sideVertex: Point = [0.19, 1.44, side * 0.21]
      expect(hasFixedPoint(head, sideVertex)).toBe(true)
      // A fixed point belongs to its IFS attractor, and every map preserves it.
      // This exact finite-address witness also belongs to the head attractor.
      const contact = apply(top.postAffine, sideVertex)
      expect(
        hasFixedPoint(
          mapsFor(knight, `knight_ear_${side < 0 ? 'back' : 'front'}`),
          contact,
        ),
      ).toBe(true)
    }
  })
})
