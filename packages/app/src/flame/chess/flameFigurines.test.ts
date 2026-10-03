/**
 * Native nonlinear figurine checks: interpret exported maps in independent
 * physical component frames, prove bounded chaos games, and sample the actual
 * production CPU path for scale, colour separation and nonlinear shape.
 */
import { describe, expect, it } from 'vitest'
import { validateFlame3D } from '../schema/flameSchema'
import { evaluateFlameFigurineTransform, sampleFlameFigurineCloud, } from './flameFigurineCloud'
import { buildFlameFigurine, FLAME_FIGURINES } from './flameFigurines'
import type { AffineParams3D } from '@chaos-master/core'
import type { FlameDescriptor3D, TransformId } from '../schema/flameSchema'

type Point = readonly [number, number, number]
type FrameSpec = {
  centre: Point
  scales: Point
  lean?: number
  horizontal?: boolean
}
type Map3D = FlameDescriptor3D['transforms'][TransformId]
const IDS = FLAME_FIGURINES.map((study) => study.id)
const FRAMES: Record<string, FrameSpec> = {
  aurora_roots: {
    centre: [0, 0.12, 0],
    scales: [0.64, 0.06, 0.64],
    horizontal: true,
  },
  aurora_weave_left: {
    centre: [-0.065, 0.77, 0],
    scales: [0.23, 0.59, 0.21],
    lean: -0.16,
  },
  aurora_weave_right: {
    centre: [0.065, 0.77, 0],
    scales: [0.23, 0.59, 0.21],
    lean: 0.16,
  },
  aurora_corolla: { centre: [0, 1.25, 0], scales: [0.36, 0.28, 0.34] },
  aurora_crest: { centre: [0, 1.69, 0], scales: [0.065, 0.16, 0.065] },
  ember_roots: {
    centre: [0, 0.12, 0],
    scales: [0.6, 0.06, 0.6],
    horizontal: true,
  },
  ember_mantle: { centre: [0, 0.74, 0], scales: [0.34, 0.65, 0.3] },
  ember_orbit: {
    centre: [0, 1.08, 0],
    scales: [0.28, 0.025, 0.28],
    horizontal: true,
  },
  ember_mitre_left: {
    centre: [-0.13, 1.39, 0],
    scales: [0.21, 0.4, 0.23],
    lean: -0.4,
  },
  ember_mitre_right: {
    centre: [0.13, 1.39, 0],
    scales: [0.21, 0.4, 0.23],
    lean: 0.4,
  },
  tidal_roots: {
    centre: [0, 0.12, 0],
    scales: [0.62, 0.06, 0.62],
    horizontal: true,
  },
  tidal_current: {
    centre: [-0.04, 0.78, 0],
    scales: [0.37, 0.64, 0.33],
    lean: 0.28,
  },
  tidal_mane: {
    centre: [-0.16, 1.08, -0.015],
    scales: [0.27, 0.42, 0.33],
    lean: -0.32,
  },
  tidal_head: {
    centre: [0.2, 1.37, 0],
    scales: [0.34, 0.29, 0.27],
    lean: -0.45,
  },
  tidal_muzzle: {
    centre: [0.42, 1.28, 0],
    scales: [0.29, 0.18, 0.24],
    lean: -0.2,
  },
  tidal_fin_back: {
    centre: [0.035, 1.68, -0.11],
    scales: [0.065, 0.18, 0.07],
    lean: -0.3,
  },
  tidal_fin_front: {
    centre: [0.11, 1.67, 0.11],
    scales: [0.065, 0.18, 0.07],
    lean: 0.1,
  },
}

function apply(m: AffineParams3D, p: Point): Point {
  return [
    m.a * p[0] + m.b * p[1] + m.c * p[2] + m.d,
    m.e * p[0] + m.f * p[1] + m.g * p[2] + m.h,
    m.i * p[0] + m.j * p[1] + m.k * p[2] + m.l,
  ]
}
const difference = (a: Point, b: Point): Point => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const norm = (point: Point) => Math.hypot(...point)

function toWorld(spec: FrameSpec, point: Point): Point {
  const [x, y, z] = spec.horizontal ? [point[0], point[2], point[1]] : point
  const c = Math.cos(spec.lean ?? 0),
    s = Math.sin(spec.lean ?? 0)
  return [
    spec.centre[0] + spec.scales[0] * (c * x - s * y),
    spec.centre[1] + spec.scales[1] * (s * x + c * y),
    spec.centre[2] + spec.scales[2] * z,
  ]
}

function toLocal(spec: FrameSpec, point: Point): Point {
  const x = (point[0] - spec.centre[0]) / spec.scales[0]
  const y = (point[1] - spec.centre[1]) / spec.scales[1]
  const z = (point[2] - spec.centre[2]) / spec.scales[2]
  const c = Math.cos(spec.lean ?? 0),
    s = Math.sin(spec.lean ?? 0)
  const rotated: Point = [c * x + s * y, -s * x + c * y, z]
  return spec.horizontal ? [rotated[0], rotated[2], rotated[1]] : rotated
}

/** Independent singular-value upper bound from the recovered local columns. */
function matrixBound(columns: Point[]): number {
  const gram = columns.map((a) =>
    columns.map((b) => a.reduce((sum, value, n) => sum + value * b[n]!, 0)),
  )
  return Math.sqrt(
    Math.max(
      ...gram.map((row) =>
        row.reduce((sum, value) => sum + Math.abs(value), 0),
      ),
    ),
  )
}

function localBounds(map: Map3D, spec: FrameSpec) {
  const axes: Point[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const preOffset = apply(map.preAffine, spec.centre)
  const preColumns = axes.map((axis) =>
    difference(apply(map.preAffine, toWorld(spec, axis)), preOffset),
  )
  const postOffset = toLocal(spec, apply(map.postAffine, [0, 0, 0]))
  const postColumns = axes.map((axis) =>
    difference(toLocal(spec, apply(map.postAffine, axis)), postOffset),
  )
  return {
    pre: matrixBound(preColumns),
    shift: norm(preOffset),
    post: matrixBound(postColumns),
    offset: norm(postOffset),
  }
}

describe('hybrid flame figurines', () => {
  it('offers three designs with different anatomical forms and recurrence families', () => {
    expect(IDS).toEqual(['aurora-queen', 'ember-bishop', 'tidal-knight'])
    expect(FLAME_FIGURINES.map((entry) => entry.piece)).toEqual([
      'queen',
      'bishop',
      'knight',
    ])
    expect(new Set(FLAME_FIGURINES.map((entry) => entry.family)).size).toBe(3)
    expect(
      FLAME_FIGURINES.find((entry) => entry.id === 'ember-bishop')!.family,
    ).toContain('Barnsley')
  })

  it.each(IDS)(
    '%s persists true mixed native recurrences and three component hues',
    (id) => {
      const flame = validateFlame3D(buildFlameFigurine(id))
      const maps = Object.values(flame.transforms)
      expect(maps.length).toBeLessThanOrEqual(128)
      expect(maps.reduce((sum, map) => sum + map.probability, 0)).toBeCloseTo(
        1,
        12,
      )
      const kinds = new Set(
        maps.flatMap((map) => Object.values(map.variations).map((v) => v.type)),
      )
      expect(kinds).toEqual(
        new Set(['linear3D', 'sinusoidal3D', 'swirl3D', 'curl3D']),
      )
      expect(new Set(maps.map((map) => JSON.stringify(map.color))).size).toBe(3)
      for (const map of maps) {
        expect(FRAMES[map.walkGroup!]).toBeDefined()
        expect(map.probability).toBeGreaterThan(0)
        expect(
          Object.values(map.variations).reduce((sum, v) => sum + v.weight, 0),
        ).toBeCloseTo(1, 12)
        expect(map.colorSpeed).toBe(0.85)
      }
      expect(validateFlame3D(JSON.parse(JSON.stringify(flame)))).toEqual(flame)
      expect(buildFlameFigurine(id)).toEqual(flame)
      expect(buildFlameFigurine(id).transforms).not.toBe(flame.transforms)
      const alternate = validateFlame3D(buildFlameFigurine(id, 'dark'))
      for (const [key, map] of Object.entries(flame.transforms)) {
        const other = alternate.transforms[key as TransformId]!
        expect(other.preAffine).toEqual(map.preAffine)
        expect(other.postAffine).toEqual(map.postAffine)
        expect(other.variations).toEqual(map.variations)
        expect(other.color).toEqual({ x: -map.color.x, y: -map.color.y })
      }
    },
  )

  it.each(IDS)(
    '%s has an invariant local bound and brings escaping chains back toward it',
    (id) => {
      const flame = validateFlame3D(buildFlameFigurine(id))
      for (const map of Object.values(flame.transforms)) {
        const spec = FRAMES[map.walkGroup!]!,
          m = localBounds(map, spec)
        const radius = map.walkGroup === 'ember_mantle' ? 3 : 2
        let radialWeight = 0,
          boundedWeight = 0
        for (const v of Object.values(map.variations)) {
          // Swirl preserves Euclidean length, sin has norm <=sqrt(3), and
          // curl's numerator norm equals its positive denominator before EPS.
          if (v.type === 'sinusoidal3D')
            boundedWeight += v.weight * Math.sqrt(3)
          else if (v.type === 'curl3D') boundedWeight += v.weight
          else radialWeight += v.weight
        }
        const gain = m.post * radialWeight * m.pre
        const intercept =
          m.post * (radialWeight * m.shift + boundedWeight) + m.offset
        expect(gain).toBeLessThan(1)
        expect(gain * radius + intercept).toBeLessThanOrEqual(radius + 1e-10)
        // This is a radial growth bound, not an unsupported Lipschitz claim
        // about the nonlinear swirl/curl maps.
      }
    },
  )

  it.each(IDS)(
    '%s grows a non-flat human-scale cloud with separate part colours',
    (id) => {
      const flame = buildFlameFigurine(id)
      const cloud = sampleFlameFigurineCloud(flame, {
        count: 12000,
        seed: 619,
        burnIn: 128,
      })
      expect(cloud.bounds.min[1]).toBeGreaterThanOrEqual(-1e-5)
      expect(cloud.bounds.min[1]).toBeLessThan(0.06)
      expect(cloud.bounds.max[1]).toBeGreaterThan(1.65)
      expect(cloud.bounds.max[1]).toBeLessThan(2.1)
      expect(cloud.bounds.max[0] - cloud.bounds.min[0]).toBeGreaterThan(0.7)
      expect(cloud.bounds.max[2] - cloud.bounds.min[2]).toBeGreaterThan(0.3)
      const colours = new Set<string>()
      for (let n = 0; n < cloud.count; n++) {
        expect(cloud.points[n * 4 + 3]).toBe(1)
        colours.add(
          `${cloud.colorCoordinates[n * 2]!.toFixed(3)},${cloud.colorCoordinates[n * 2 + 1]!.toFixed(3)}`,
        )
      }
      expect(colours.size).toBe(3)
      const second = sampleFlameFigurineCloud(flame, {
        count: 12000,
        seed: 619,
        burnIn: 128,
      })
      expect(second.points).toEqual(cloud.points)
      expect(second.colors).toEqual(cloud.colors)
    },
  )

  it.each(IDS)(
    '%s uses nonlinear shape rather than just nonlinear labels',
    (id) => {
      const flame = validateFlame3D(buildFlameFigurine(id))
      const curvedGroups = new Set<string>()
      for (const map of Object.values(flame.transforms)) {
        const spec = FRAMES[map.walkGroup!]!
        const p = toWorld(spec, [0.25, 0.4, -0.2]),
          delta: Point = [0.4, -0.3, 0.2]
        const a = evaluateFlameFigurineTransform(map, p).position
        const b = evaluateFlameFigurineTransform(
          map,
          toWorld(spec, [0.25 + delta[0], 0.4 + delta[1], -0.2 + delta[2]]),
        ).position
        const c = evaluateFlameFigurineTransform(
          map,
          toWorld(spec, [0.25 - delta[0], 0.4 - delta[1], -0.2 - delta[2]]),
        ).position
        const midpoint: Point = [
          (b[0] + c[0]) / 2,
          (b[1] + c[1]) / 2,
          (b[2] + c[2]) / 2,
        ]
        if (norm(difference(a, midpoint)) > 0.001)
          curvedGroups.add(map.walkGroup!)
      }
      expect(curvedGroups.size).toBeGreaterThanOrEqual(3)
    },
  )

  it('grounds every root recurrence at an actual fixed point on Y=0', () => {
    for (const id of IDS) {
      const flame = validateFlame3D(buildFlameFigurine(id))
      const root = Object.values(flame.transforms).find(
        (map) =>
          map.walkGroup!.endsWith('_roots') &&
          Object.values(map.variations).every((v) => v.type === 'linear3D'),
      )!
      const result = evaluateFlameFigurineTransform(root, [0, 0, 0]).position
      expect(norm(result)).toBeLessThan(1e-10)
    }
  })

  it('grows opposed recursive fern fronds with genuine depth coupling in the bishop', () => {
    const flame = validateFlame3D(buildFlameFigurine('ember-bishop'))
    const maps = Object.values(flame.transforms).filter(
      (map) => map.walkGroup === 'ember_mantle',
    )
    expect(maps).toHaveLength(4)
    expect(maps.map((map) => map.probability / 0.36)).toEqual([
      0.01, 0.85, 0.07, 0.07,
    ])
    expect(maps[2]!.preAffine.b).toBeLessThan(0)
    expect(maps[3]!.preAffine.b).toBeGreaterThan(0)
    expect(
      maps
        .slice(1)
        .every(
          (map) => Math.abs(map.preAffine.i) + Math.abs(map.preAffine.j) > 0,
        ),
    ).toBe(true)
    for (const map of maps) {
      const local = localBounds(map, FRAMES.ember_mantle!)
      // Linear plus sinusoidal is 1-Lipschitz before the affine skeleton.
      expect(local.pre).toBeLessThan(0.95)
      expect(
        Object.values(map.variations).map((v) => [v.type, v.weight]),
      ).toEqual([
        ['linear3D', 0.94],
        ['sinusoidal3D', 0.06],
      ])
    }
  })
})
