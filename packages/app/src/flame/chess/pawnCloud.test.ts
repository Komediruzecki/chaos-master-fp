/** Native affine order, volume sampling, independent groups, and reproducible baking. */
import { describe, expect, it } from 'vitest'
import { IDENTITY_AFFINE } from '../clash/placement'
import { validateFlame } from '../schema/flameSchema'
import { samplePawnCloud } from './pawnCloud'
import { buildPawnFlame } from './pawnFlame'
import { buildStructuralPawnFlame } from './structuralPawnFlame'

function oneMap(overrides: Record<string, unknown> = {}) {
  return validateFlame({
    ...buildPawnFlame(),
    transforms: {
      sample: {
        probability: 1,
        visible: true,
        color: { x: 0, y: 0 },
        colorSpeed: 0.4,
        preAffine: { ...IDENTITY_AFFINE },
        postAffine: { ...IDENTITY_AFFINE },
        variations: { linear: { type: 'linear3D', weight: 1, visible: true } },
        ...overrides,
      },
    },
  })
}

describe('samplePawnCloud', () => {
  it.each([buildPawnFlame, buildStructuralPawnFlame])(
    'reproduces a finite native pawn cloud without changing its descriptor',
    (build) => {
      const flame = build({ openness: 0.6, twist: 0.4 })
      const before = JSON.stringify(flame)
      const a = samplePawnCloud(flame, { count: 2048, seed: 12 })
      expect(a.points).toEqual(
        samplePawnCloud(flame, { count: 2048, seed: 12 }).points,
      )
      expect(a.points).not.toEqual(
        samplePawnCloud(flame, { count: 2048, seed: 13 }).points,
      )
      expect(a.count).toBe(2048)
      expect(a.points.length).toBe(8192)
      for (let n = 0; n < a.count; n++) {
        expect(a.points[n * 4 + 3]).toBe(1)
        expect(a.points[n * 4 + 1]).toBeGreaterThanOrEqual(-1e-6)
        expect(a.points[n * 4 + 1]).toBeLessThanOrEqual(1.800001)
        expect(
          Math.hypot(a.points[n * 4]!, a.points[n * 4 + 2]!),
        ).toBeLessThanOrEqual(0.640001)
      }
      expect(JSON.stringify(flame)).toBe(before)
    },
  )

  it('applies pre affine, the weighted variation sum, post affine, and plot-only final affine in order', () => {
    const flame = oneMap({
      preAffine: { ...IDENTITY_AFFINE, a: 0, f: 0, k: 0, d: 1, h: 2, l: 3 },
      postAffine: {
        ...IDENTITY_AFFINE,
        a: 3,
        f: 0.5,
        k: -1,
        d: 2,
        h: -1,
        l: 4,
      },
      variations: {
        a: { type: 'linear3D', weight: 0.5 },
        b: { type: 'linear3D', weight: 1.5 },
      },
    })
    flame.finalTransform = { ...IDENTITY_AFFINE, d: 10, h: 20, l: 30 }
    expect(Array.from(samplePawnCloud(flame, { count: 2 }).points)).toEqual([
      18, 21, 28, 1, 18, 21, 28, 1,
    ])
  })

  it('keeps independently tagged chains at their own fixed points and allocates authored group masses', () => {
    const template = Object.values(oneMap().transforms)[0]!
    const flame = validateFlame({
      ...buildPawnFlame(),
      transforms: {
        left: {
          ...template,
          walkGroup: 'left',
          probability: 1,
          postAffine: { ...IDENTITY_AFFINE, a: 0.5, f: 0, k: 0, d: -5 },
        },
        right: {
          ...template,
          walkGroup: 'right',
          probability: 3,
          postAffine: { ...IDENTITY_AFFINE, a: 0.5, f: 0, k: 0, d: 5 },
        },
      },
    })
    const cloud = samplePawnCloud(flame, { count: 32, burnIn: 64 })
    for (let n = 0; n < cloud.count; n++)
      expect(cloud.points[n * 4]).toBe(n < 8 ? -10 : 10)
  })

  it('keeps the final affine out of subsequent chaos-game iterations', () => {
    const flame = oneMap({
      postAffine: { ...IDENTITY_AFFINE, a: 0.5, f: 0, k: 0, d: 1 },
    })
    flame.finalTransform = { ...IDENTITY_AFFINE, d: 10 }
    expect(
      Array.from(samplePawnCloud(flame, { count: 2, burnIn: 64 }).points),
    ).toEqual([12, 0, 0, 1, 12, 0, 0, 1])
  })

  it('samples blur3D uniformly inside a volume and ignores the pre-affine position', () => {
    const flame = oneMap({
      preAffine: { ...IDENTITY_AFFINE, d: 100, h: 100, l: 100 },
      variations: { ball: { type: 'blur3D', weight: 1 } },
    })
    const cloud = samplePawnCloud(flame, { count: 6000, seed: 53 })
    let radiusSquared = 0
    for (let n = 0; n < cloud.count; n++) {
      const r2 =
        cloud.points[n * 4]! ** 2 +
        cloud.points[n * 4 + 1]! ** 2 +
        cloud.points[n * 4 + 2]! ** 2
      expect(r2).toBeLessThanOrEqual(1.000001)
      radiusSquared += r2
    }
    // A uniform unit sphere surface gives 1; a uniform unit ball gives 3/5.
    expect(radiusSquared / cloud.count).toBeCloseTo(0.6, 1)
  })

  it('rejects unsupported active variations and a board cloud with no visible maps', () => {
    expect(() =>
      samplePawnCloud(
        oneMap({ variations: { sphere: { type: 'spherical3D', weight: 1 } } }),
        { count: 1 },
      ),
    ).toThrow('Unsupported pawn sampling variation: spherical3D')
    expect(() =>
      samplePawnCloud(oneMap({ visible: false }), { count: 1 }),
    ).toThrow('positive-probability')
    expect(() => samplePawnCloud(oneMap(), { count: Number.NaN })).toThrow(
      'count',
    )
  })
})
