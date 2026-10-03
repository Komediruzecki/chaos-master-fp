/**
 * Structural pawn tests interpret the exported, group-locked native affine
 * chaos games. Local bounds and deleted cells are checked independently of
 * the builder, including cavities at several recursive address levels.
 */
import { describe, expect, it } from 'vitest'
import { validateFlame3D } from '../schema/flameSchema'
import { buildPawnFlame } from './pawnFlame'
import { buildStructuralPawnFlame, DEFAULT_STRUCTURAL_PAWN_RECIPE, } from './structuralPawnFlame'
import type { AffineParams3D } from '@chaos-master/core'
import type { FlameDescriptor, FlameDescriptor3D, TransformId, } from '../schema/flameSchema'
import type { PawnRecipe } from './pawnFlame'

type Point = readonly [number, number, number]
type Map3D = FlameDescriptor3D['transforms'][TransformId] & {
  walkGroup?: string
}
type Group = { maps: Map3D[]; points: Point[]; mass: number }

function apply(m: AffineParams3D, p: Point): Point {
  return [
    m.a * p[0] + m.b * p[1] + m.c * p[2] + m.d,
    m.e * p[0] + m.f * p[1] + m.g * p[2] + m.h,
    m.i * p[0] + m.j * p[1] + m.k * p[2] + m.l,
  ]
}

function step(map: Map3D, point: Point): Point {
  const pre = apply(map.preAffine, point)
  let weight = 0
  for (const v of Object.values(map.variations)) {
    if (v.type !== 'linear3D')
      throw new Error(`Structural geometry cannot use ${v.type}`)
    weight += v.weight
  }
  return apply(map.postAffine, [
    pre[0] * weight,
    pre[1] * weight,
    pre[2] * weight,
  ])
}

/** Every chain stays in one component; map probabilities normalize within it. */
function sample(flame: FlameDescriptor, count = 50_000): Map<string, Group> {
  const native = validateFlame3D(flame)
  const groups = new Map<string, Group>()
  for (const map of Object.values(native.transforms) as Map3D[]) {
    if (!map.walkGroup)
      throw new Error('A structural map lost its walker group')
    const group = groups.get(map.walkGroup) ?? { maps: [], points: [], mass: 0 }
    group.maps.push(map)
    group.mass += map.probability
    groups.set(map.walkGroup, group)
  }
  let seed = 731
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.mass, 0)
  for (const group of groups.values()) {
    let point: Point = [3, -4, 5]
    const quota = Math.ceil((group.mass / total) * count)
    for (let n = 0; n < quota + 64; n++) {
      let remaining = random() * group.mass
      let chosen = group.maps[group.maps.length - 1]!
      for (const map of group.maps) {
        remaining -= map.probability
        if (remaining < 0) {
          chosen = map
          break
        }
      }
      point = step(chosen, point)
      if (n >= 64) group.points.push(point)
    }
  }
  return groups
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
const radial = (p: Point) => Math.hypot(p[0], p[2])

function corner(map: Map3D): Point {
  const m = map.postAffine
  return [m.d / (1 - m.a), m.h / (1 - m.f), m.l / (1 - m.k)]
}

/** Independent barycentric coordinates of a point inside a tetrahedron. */
function barycentric(p: Point, vertices: Point[]) {
  const a = sub(vertices[1]!, vertices[0]!)
  const b = sub(vertices[2]!, vertices[0]!)
  const c = sub(vertices[3]!, vertices[0]!)
  const delta = sub(p, vertices[0]!)
  const determinant = dot(a, cross(b, c))
  const x = dot(delta, cross(b, c)) / determinant
  const y = dot(a, cross(delta, c)) / determinant
  const z = dot(a, cross(b, delta)) / determinant
  return [1 - x - y - z, x, y, z]
}

const cases: Partial<PawnRecipe>[] = [
  {},
  { branchCount: 3, openness: 0, twist: -Math.PI },
  { branchCount: 8, openness: 1, twist: Math.PI },
]

describe('structural pawn descriptor', () => {
  it('persists 23 local groups and only genuine native affine maps', () => {
    const flame = buildStructuralPawnFlame()
    expect(flame).toEqual(
      buildStructuralPawnFlame(DEFAULT_STRUCTURAL_PAWN_RECIPE),
    )
    expect(validateFlame3D(JSON.parse(JSON.stringify(flame)))).toEqual(flame)
    const maps = Object.values(flame.transforms) as Map3D[]
    expect(maps).toHaveLength(122)
    expect(
      Object.keys(buildStructuralPawnFlame({ branchCount: 8 }).transforms),
    ).toHaveLength(126)
    expect(new Set(maps.map((map) => map.walkGroup)).size).toBe(23)
    expect(
      maps.every(
        (map) => typeof map.walkGroup === 'string' && map.walkGroup.length > 0,
      ),
    ).toBe(true)
    expect(maps.reduce((sum, map) => sum + map.probability, 0)).toBeCloseTo(
      1,
      12,
    )
    for (const map of maps)
      expect(Object.values(map.variations)).toEqual([
        { type: 'linear3D', weight: 1, visible: true },
      ])
    expect(flame.finalTransform).toBeUndefined()
    expect(flame.renderSettings.dimensions).toBe(3)
    expect(flame.renderSettings.camera3D.target).toEqual([0, 0.9, 0])
  })

  it('retains the independent glass echo and changes only appearance for side variants', () => {
    const original = buildPawnFlame()
    const frost = buildStructuralPawnFlame({ side: 'light' })
    const ember = buildStructuralPawnFlame({ side: 'dark' })
    const geometry = (flame: FlameDescriptor) =>
      [...sample(flame, 1000)].map(([id, group]) => [id, group.points])
    expect(geometry(frost)).toEqual(geometry(ember))
    expect(Object.values(frost.transforms)[0]!.color).not.toEqual(
      Object.values(ember.transforms)[0]!.color,
    )
    expect(buildPawnFlame()).toEqual(original)
    frost.renderSettings.camera3D.target[1] = 30
    Object.values(frost.transforms)[0]!.postAffine.a = 20
    expect(buildStructuralPawnFlame()).not.toEqual(frost)
    expect(buildPawnFlame()).toEqual(original)
  })
})

describe.each(cases)('structural pawn geometry at %j', (recipe) => {
  const flame = buildStructuralPawnFlame(recipe)
  const groups = sample(flame)

  it('strictly contracts every native affine and remains bounded with a tapered shaft', () => {
    for (const map of Object.values(validateFlame3D(flame).transforms)) {
      const m = map.postAffine
      // The maximum absolute row sum of A^T A bounds its largest eigenvalue,
      // hence its square root bounds the affine's Euclidean operator norm.
      // Unlike the Frobenius norm, this proves the widened, yawed trunk is a
      // contraction: its three singular values are c, .68, c.
      const columns: Point[] = [
        [m.a, m.e, m.i],
        [m.b, m.f, m.j],
        [m.c, m.g, m.k],
      ]
      const norm = Math.sqrt(
        Math.max(
          ...columns.map((column) =>
            columns.reduce(
              (sum, other) => sum + Math.abs(dot(column, other)),
              0,
            ),
          ),
        ),
      )
      expect(norm).toBeGreaterThan(0)
      expect(norm).toBeLessThan(0.7)
    }
    for (const group of groups.values())
      for (const p of group.points) {
        expect(p.every(Number.isFinite)).toBe(true)
        expect(p[1]).toBeGreaterThanOrEqual(-1e-9)
        expect(p[1]).toBeLessThanOrEqual(1.8 + 1e-9)
        expect(radial(p)).toBeLessThanOrEqual(0.64 + 1e-9)
      }
    const shaft = groups.get('shaft')!
    for (const map of shaft.maps) {
      for (const y of [0, 0.25, 0.5, 0.75, 1])
        for (let n = 0; n < 16; n++) {
          const theta = (n / 16) * 2 * Math.PI
          const p = step(map, [
            0.3 * (1 - y) * Math.cos(theta),
            0.22 + 0.96 * y,
            0.3 * (1 - y) * Math.sin(theta),
          ])
          const normalizedY = (p[1] - 0.22) / 0.96
          expect(normalizedY).toBeGreaterThanOrEqual(-1e-12)
          expect(normalizedY).toBeLessThanOrEqual(1 + 1e-12)
          expect(radial(p) / 0.3).toBeLessThanOrEqual(1 - normalizedY + 1e-12)
        }
    }
  })

  it('makes twenty actual icosahedral facets with Sierpinski cavities at four scales', () => {
    const facets = [...groups.entries()].filter(([id]) =>
      id.startsWith('head_'),
    )
    expect(facets).toHaveLength(20)
    const vertices = [
      ...new Map(
        facets
          .flatMap(([, group]) => group.maps.map(corner))
          .filter((p) => Math.hypot(p[0], p[1] - 1.46, p[2]) > 0.2)
          .map((p) => [p.map((x) => x.toFixed(8)).join(','), p]),
      ).values(),
    ]
    expect(vertices).toHaveLength(12)
    for (const vertex of vertices)
      expect(Math.hypot(vertex[0], vertex[1] - 1.46, vertex[2])).toBeCloseTo(
        0.34,
        10,
      )
    expect(Math.max(...vertices.map((p) => p[1]))).toBeCloseTo(1.8, 10)
    expect(Math.min(...vertices.map((p) => p[1]))).toBeCloseTo(1.12, 10)
    for (const [, group] of facets) {
      const corners = group.maps.map(corner)
      const outer = corners.filter(
        (p) => Math.hypot(p[0], p[1] - 1.46, p[2]) > 0.2,
      )
      expect(outer).toHaveLength(3)
      const normal = cross(sub(outer[1]!, outer[0]!), sub(outer[2]!, outer[0]!))
      const plane = dot(normal, outer[0]!)
      const signed = vertices.map((p) => dot(normal, p) - plane)
      expect(
        signed.every((d) => d <= 1e-9) || signed.every((d) => d >= -1e-9),
      ).toBe(true)
      const scale = group.maps[0]!.postAffine.a
      for (const point of group.points.slice(0, 80)) {
        let p = point
        for (let level = 0; level < 4; level++) {
          const weights = barycentric(p, corners)
          expect(Math.min(...weights)).toBeGreaterThanOrEqual(-1e-8)
          const address = weights.indexOf(Math.max(...weights))
          expect(weights[address]).toBeGreaterThanOrEqual(1 - scale - 1e-8)
          const v = corners[address]!
          p = [
            (p[0] - (1 - scale) * v[0]) / scale,
            (p[1] - (1 - scale) * v[1]) / scale,
            (p[2] - (1 - scale) * v[2]) / scale,
          ]
        }
      }
    }
  })

  it('carves Menger and Cantor voids in the geometry at four recursive scales', () => {
    const foot = groups.get('foot')!
    expect(foot.maps).toHaveLength(20)
    const footScale = foot.maps[0]!.postAffine.a
    for (const point of foot.points.slice(0, 500)) {
      let p: Point = [
        point[0] / (0.64 / Math.sqrt(2)),
        (point[1] - 0.11) / 0.11,
        point[2] / (0.64 / Math.sqrt(2)),
      ]
      for (let level = 0; level < 4; level++) {
        expect(
          p.filter((x) => Math.abs(x) < 1 - 2 * footScale - 1e-8).length,
        ).toBeLessThan(2)
        const address = p.map((x) => Math.round(x / (1 - footScale)))
        expect(address.filter((x) => x === 0).length).toBeLessThan(2)
        p = [
          (p[0] - (1 - footScale) * address[0]!) / footScale,
          (p[1] - (1 - footScale) * address[1]!) / footScale,
          (p[2] - (1 - footScale) * address[2]!) / footScale,
        ]
      }
    }
    const collar = groups.get('collar')!
    expect(collar.maps).toHaveLength(8)
    const collarScale = collar.maps[0]!.postAffine.a
    for (const point of collar.points.slice(0, 500)) {
      let p: Point = [
        point[0] / (0.23 / Math.sqrt(2)),
        (point[1] - 1.105) / 0.055,
        point[2] / (0.23 / Math.sqrt(2)),
      ]
      for (let level = 0; level < 4; level++) {
        expect(Math.min(...p.map(Math.abs))).toBeGreaterThanOrEqual(
          1 - 2 * collarScale - 1e-8,
        )
        const unfold = (x: number) =>
          (x - (1 - collarScale) * Math.sign(x)) / collarScale
        p = [unfold(p[0]), unfold(p[1]), unfold(p[2])]
      }
    }
  })

  it('retains a broad contact foot, narrow shaft, faceted round head and real depth', () => {
    const foot = groups.get('foot')!.points
    const shaft = groups.get('shaft')!.points
    const head = [...groups.entries()]
      .filter(([id]) => id.startsWith('head_'))
      .flatMap(([, group]) => group.points)
    expect(Math.min(...foot.map((p) => p[1]))).toBeLessThan(0.01)
    expect(Math.max(...foot.map(radial))).toBeGreaterThan(0.6)
    expect(Math.max(...head.map((p) => p[1]))).toBeGreaterThan(1.76)
    expect(Math.min(...head.map((p) => p[1]))).toBeLessThan(1.16)
    for (const axis of [0, 2]) {
      expect(
        Math.max(...head.map((p) => p[axis]!)) -
          Math.min(...head.map((p) => p[axis]!)),
      ).toBeGreaterThan(0.57)
      expect(
        Math.abs(head.reduce((sum, p) => sum + p[axis]!, 0) / head.length),
      ).toBeLessThan(0.008)
    }
    const middle = shaft.filter((p) => p[1] > 0.6 && p[1] < 0.9)
    expect(middle.length).toBeGreaterThan(1000)
    expect(Math.max(...middle.map(radial))).toBeLessThan(0.182)
    const heightBins = Array<number>(16).fill(0)
    for (const p of shaft)
      heightBins[Math.min(15, Math.floor(((p[1] - 0.22) / 0.96) * 16))]!++
    expect(Math.min(...heightBins)).toBeGreaterThan(5)
  })
})
