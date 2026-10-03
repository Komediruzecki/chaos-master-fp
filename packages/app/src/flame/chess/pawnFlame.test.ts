/**
 * The pawn must survive the actual chaos game, including cross-compositions
 * between scaffold terminals and recursive detail. These tests interpret the
 * exported native maps, including blur3D's unit-ball distribution, rather than
 * a separate preview shape or anchor generator.
 */
import { describe, expect, it } from 'vitest'
import { validateFlame3D } from '../schema/flameSchema'
import { buildPawnFlame, DEFAULT_PAWN_RECIPE, normalizePawnRecipe, PAWN_BASE_RADIUS, PAWN_HEIGHT, } from './pawnFlame'
import type { AffineParams3D } from '@chaos-master/core'
import type { FlameDescriptor, FlameDescriptor3D, TransformId, } from '../schema/flameSchema'
import type { PawnRecipe } from './pawnFlame'

type Point = readonly [number, number, number]
type Map3D = FlameDescriptor3D['transforms'][TransformId]

function affine(m: AffineParams3D, p: Point): Point {
  return [
    m.a * p[0] + m.b * p[1] + m.c * p[2] + m.d,
    m.e * p[0] + m.f * p[1] + m.g * p[2] + m.h,
    m.i * p[0] + m.j * p[1] + m.k * p[2] + m.l,
  ]
}

/** Same native variation definitions and pre -> weighted sum -> post ordering. */
function applyMap(
  map: Map3D,
  point: Point,
  random: () => number = () => 0.5,
): Point {
  const p = affine(map.preAffine, point)
  const result = [0, 0, 0]
  for (const variation of Object.values(map.variations)) {
    let varied = p
    if (variation.type === 'blur3D') {
      const theta = random() * 2 * Math.PI
      const phi = Math.acos(2 * random() - 1)
      const radius = random() ** (1 / 3)
      varied = [
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      ]
    } else if (variation.type !== 'linear3D') {
      throw new Error(`The pawn sampler cannot evaluate ${variation.type}`)
    }
    for (let axis = 0; axis < 3; axis++)
      result[axis]! += varied[axis]! * variation.weight
  }
  return affine(map.postAffine, [result[0]!, result[1]!, result[2]!])
}

function sample(flame: FlameDescriptor, count = 30_000): Point[] {
  const native = validateFlame3D(flame)
  const maps = Object.values(native.transforms)
  const total = maps.reduce((sum, map) => sum + map.probability, 0)
  let seed = 1297
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  let point: Point = [17, -13, 9]
  const out: Point[] = []
  for (let n = 0; n < count + 32; n++) {
    let remaining = random() * total
    let chosen = maps[maps.length - 1]!
    for (const map of maps) {
      remaining -= map.probability
      if (remaining < 0) {
        chosen = map
        break
      }
    }
    point = applyMap(chosen, point, random)
    if (n >= 32)
      out.push(
        native.finalTransform ? affine(native.finalTransform, point) : point,
      )
  }
  return out
}

const radial = (point: Point) => Math.hypot(point[0], point[2])

function quantile(values: number[], fraction: number) {
  values.sort((a, b) => a - b)
  return values[Math.floor((values.length - 1) * fraction)]!
}

const extremes: Partial<PawnRecipe>[] = [
  {},
  { branchCount: 3, openness: 0, twist: -Math.PI },
  { branchCount: 8, openness: 0, twist: Math.PI },
  { branchCount: 3, openness: 1, twist: Math.PI },
  { branchCount: 8, openness: 1, twist: -Math.PI },
]

describe('pawn recipe', () => {
  it('normalizes finite controls without quantizing authored continuous values', () => {
    expect(normalizePawnRecipe()).toEqual(DEFAULT_PAWN_RECIPE)
    expect(
      normalizePawnRecipe({
        branchCount: 7.2,
        openness: 0.675,
        twist: -0.35,
        side: 'dark',
      }),
    ).toEqual({
      branchCount: 7,
      openness: 0.675,
      twist: -0.35,
      side: 'dark',
    })
    expect(
      normalizePawnRecipe({ branchCount: 40, openness: -1, twist: 20 }),
    ).toEqual({
      branchCount: 8,
      openness: 0,
      twist: Math.PI,
      side: 'light',
    })
    expect(
      normalizePawnRecipe({
        branchCount: NaN,
        openness: Infinity,
        twist: -Infinity,
      }),
    ).toEqual(DEFAULT_PAWN_RECIPE)
  })

  it('exports only native 3D maps within renderer limits, with normalized probabilities', () => {
    const flame = buildPawnFlame({ branchCount: 8 })
    expect(validateFlame3D(JSON.parse(JSON.stringify(flame)))).toEqual(flame)
    expect(flame.renderSettings.dimensions).toBe(3)
    expect(flame.renderSettings.pointInitMode).toBe('pointInitUnitBall')
    expect(flame.renderSettings.camera3D.target).toEqual([0, 0.9, 0])
    expect(flame.finalTransform).toBeUndefined()
    const maps = Object.values(flame.transforms)
    expect(maps).toHaveLength(101)
    expect(maps.length).toBeLessThanOrEqual(128)
    expect(maps.reduce((sum, map) => sum + map.probability, 0)).toBeCloseTo(
      1,
      12,
    )
    for (const map of maps) {
      expect(map.probability).toBeGreaterThan(0)
      expect(map.visible).toBe(true)
      const variations = Object.values(map.variations)
      expect(variations).toHaveLength(1)
      expect(variations[0]).toMatchObject({ weight: 1, visible: true })
      expect(['linear3D', 'blur3D']).toContain(variations[0]!.type)
    }
    const recursiveShare = maps
      .filter((map) => Object.values(map.variations)[0]!.type === 'linear3D')
      .reduce((sum, map) => sum + map.probability, 0)
    expect(recursiveShare).toBeGreaterThanOrEqual(0.2)
    expect(recursiveShare).toBeLessThanOrEqual(0.35)
  })

  it('changes recursive geometry with each control and gives each build independent state', () => {
    const original = buildPawnFlame()
    const same = buildPawnFlame()
    expect(same).toEqual(original)
    expect(
      Object.keys(buildPawnFlame({ branchCount: 3 }).transforms).length,
    ).toBeLessThan(Object.keys(original.transforms).length)
    expect(buildPawnFlame({ openness: 1 }).transforms).not.toEqual(
      original.transforms,
    )
    expect(buildPawnFlame({ twist: 0.8 }).transforms).not.toEqual(
      original.transforms,
    )
    original.renderSettings.camera3D.target[1] = 20
    Object.values(original.transforms)[0]!.preAffine.a = 99
    expect(same).toEqual(buildPawnFlame())
    expect(normalizePawnRecipe()).toEqual(DEFAULT_PAWN_RECIPE)
  })

  it('keeps side variants geometrically identical while changing their appearance', () => {
    const light = buildPawnFlame({ side: 'light' })
    const dark = buildPawnFlame({ side: 'dark' })
    expect(sample(light, 500)).toEqual(sample(dark, 500))
    expect(Object.values(light.transforms)[0]!.color).not.toEqual(
      Object.values(dark.transforms)[0]!.color,
    )
    expect(light.renderSettings.exposure).not.toBe(dark.renderSettings.exposure)
  })
})

describe.each(extremes)('pawn chaos game at %j', (recipe) => {
  it('contracts in every direction and keeps the entire bounding cylinder invariant', () => {
    const flame = validateFlame3D(buildPawnFlame(recipe))
    const boundary = Array.from({ length: 16 }, (_, n): Point[] => {
      const theta = (n / 16) * Math.PI * 2
      const x = Math.cos(theta) * PAWN_BASE_RADIUS
      const z = Math.sin(theta) * PAWN_BASE_RADIUS
      return [
        [x, 0, z],
        [x, PAWN_HEIGHT, z],
      ]
    }).flat()
    for (const map of Object.values(flame.transforms)) {
      if (Object.values(map.variations)[0]!.type === 'blur3D') {
        // A terminal is constant for each fixed random draw, so its contraction
        // in the previous point is zero. Its entire unit ball stays bounded.
        expect(applyMap(map, [1e6, -1e6, 1e6])).toEqual(
          applyMap(map, [0, 0, 0]),
        )
        const m = map.postAffine
        expect(m.d).toBe(0)
        expect(m.l).toBe(0)
        expect(m.b).toBe(0)
        expect(m.c).toBe(0)
        expect(m.e).toBe(0)
        expect(m.g).toBe(0)
        expect(m.i).toBe(0)
        expect(m.j).toBe(0)
        expect(m.a).toBeGreaterThan(0)
        expect(m.k).toBe(m.a)
        expect(m.a).toBeLessThanOrEqual(PAWN_BASE_RADIUS)
        expect(m.h - m.f).toBeGreaterThanOrEqual(-1e-12)
        expect(m.h + m.f).toBeLessThanOrEqual(PAWN_HEIGHT + 1e-12)
        continue
      }
      const centre = applyMap(map, [0, 0, 0])
      const basis: Point[] = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]
      const columns = basis.map((p) => {
        const moved = applyMap(map, p)
        return moved.map((v, n) => v - centre[n]!)
      })
      for (const column of columns) {
        const length = Math.hypot(...column)
        expect(length).toBeGreaterThanOrEqual(0.034999999)
        expect(length).toBeLessThanOrEqual(0.100000001)
      }
      // Orthogonal columns bounded by 0.1 establish contraction in every
      // direction, including directions off the sampled coordinate axes.
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 3; b++) {
          const dot = columns[a]!.reduce(
            (sum, v, n) => sum + v * columns[b]![n]!,
            0,
          )
          expect(dot).toBeCloseTo(0, 12)
        }
      }
      // Y is independent of XZ. Together with an orthogonal horizontal map,
      // these translation limits prove cylinder invariance at every angle.
      expect(columns[0]![1]).toBeCloseTo(0, 12)
      expect(columns[2]![1]).toBeCloseTo(0, 12)
      expect(columns[1]![0]).toBeCloseTo(0, 12)
      expect(columns[1]![2]).toBeCloseTo(0, 12)
      const scale = columns[1]![1]!
      expect(radial(centre)).toBeLessThanOrEqual(
        (1 - scale) * PAWN_BASE_RADIUS + 1e-12,
      )
      expect(centre[1]).toBeGreaterThanOrEqual(0)
      expect(centre[1]).toBeLessThanOrEqual((1 - scale) * PAWN_HEIGHT + 1e-12)
      for (const point of boundary) {
        const next = applyMap(map, point)
        expect(radial(next)).toBeLessThanOrEqual(PAWN_BASE_RADIUS + 1e-12)
        expect(next[1]).toBeGreaterThanOrEqual(-1e-12)
        expect(next[1]).toBeLessThanOrEqual(PAWN_HEIGHT + 1e-12)
      }
    }
  })

  it('samples a broad contact foot, narrow shaft and rounded head with real depth', () => {
    const points = sample(buildPawnFlame(recipe))
    const foot = points.filter((p) => p[1] < 0.35)
    const shaft = points.filter((p) => p[1] > 0.6 && p[1] < 0.95)
    const head = points.filter((p) => p[1] > 1.25 && p[1] < 1.7)
    expect(foot.length / points.length).toBeGreaterThan(0.17)
    expect(shaft.length / points.length).toBeGreaterThan(0.035)
    expect(head.length / points.length).toBeGreaterThan(0.2)
    const shaftRadius = quantile(shaft.map(radial), 0.9)
    expect(quantile(foot.map(radial), 0.9)).toBeGreaterThan(shaftRadius * 1.5)
    expect(quantile(head.map(radial), 0.9)).toBeGreaterThan(shaftRadius * 1.2)
    expect(Math.max(...points.map((p) => p[1]))).toBeGreaterThan(1.77)
    expect(Math.min(...points.map((p) => p[1]))).toBeLessThan(0.03)
    expect(
      quantile(
        points.map((p) => Math.abs(p[2])),
        0.95,
      ),
    ).toBeGreaterThan(0.3)
    for (const axis of [0, 2]) {
      expect(
        Math.abs(points.reduce((sum, p) => sum + p[axis]!, 0) / points.length),
      ).toBeLessThan(0.008)
    }
    expect(
      points.every(
        (p) =>
          p.every(Number.isFinite) &&
          p[1] >= 0 &&
          p[1] <= PAWN_HEIGHT &&
          radial(p) <= PAWN_BASE_RADIUS + 1e-12,
      ),
    ).toBe(true)
    // An intact equator and disk must occupy every angular sector. The older
    // detached miniature-pawn lattice satisfied broad radii but failed these
    // continuous silhouette requirements.
    const sectorCounts = (selected: Point[]) => {
      const counts = Array<number>(16).fill(0)
      for (const p of selected) {
        const angle = Math.atan2(p[2], p[0]) + Math.PI
        const sector = Math.min(15, Math.floor((angle / (2 * Math.PI)) * 16))
        counts[sector]!++
      }
      return counts
    }
    const disk = points.filter((p) => p[1] < 0.06 && radial(p) > 0.4)
    const equator = points.filter(
      (p) => Math.abs(p[1] - 1.46) < 0.06 && radial(p) > 0.22,
    )
    expect(Math.min(...sectorCounts(disk))).toBeGreaterThan(10)
    expect(Math.min(...sectorCounts(equator))).toBeGreaterThan(10)
    expect(
      points
        .filter((p) => p[1] > 1.35)
        .every((p) => Math.hypot(p[0], p[1] - 1.46, p[2]) <= 0.34 + 1e-12),
    ).toBe(true)
  })
})
