/** Source parity and finite material diagnostics, including failures the inspector must expose. */
import { d } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { MARCHING_GUMMY_FIXED_SCALE, MARCHING_GUMMY_RADIUS_SCALE, marchingGummyDensity, } from '@/components/GummyBear/marchingGummyMath'
import { candidateRenderFlame, CHESS_CANDIDATE_SOLID_DEFAULT, createChessCandidate, } from '@/flame/chess/chessCandidate'
import { buildFigurineStudy } from '@/flame/chess/figurineStudies'
import { samplePawnCloud } from '@/flame/chess/pawnCloud'
import { candidateSolidDensity, inspectCandidateMaterial, } from './gummyAffineIfsDiagnostics'
import { buildCandidateSolid, candidateSolidSupportError, } from './gummyAffineIfsVolume'
import { bakePointDistanceGrid } from './gummyDistanceGrid'
import type { ChessCandidate } from '@/flame/chess/chessCandidate'
import type { FigurineStudyId } from '@/flame/chess/figurineStudies'

function candidate(id: FigurineStudyId = 'menger-rook'): ChessCandidate {
  return {
    ...createChessCandidate(buildFigurineStudy(id)),
    version: 2,
    solid: { ...CHESS_CANDIDATE_SOLID_DEFAULT },
  }
}

describe('affine IFS finite solid inspection', () => {
  it('computes known Euclidean distances, clips only the ground, and preserves world translation', () => {
    const grid = bakePointDistanceGrid(
      new Float32Array([0.5, 0.5, 0.5, 1, 0.75, 0.5, 0.5, 1]),
      0.05,
      0.0125,
    )
    expect(grid.field([0.5, 0.5, 0.5])).toBeCloseTo(-0.05, 6)
    expect(grid.field([0.625, 0.5, 0.5])).toBeCloseTo(0.075, 6)
    expect(grid.field([0.5, 0.65, 0.5])).toBeCloseTo(0.1, 6)
    expect(grid.field([0.5, -0.02, 0.5])).toBeGreaterThanOrEqual(0.02)
    expect(grid.sourceBounds).toEqual({
      min: [0.5, 0.5, 0.5],
      max: [0.75, 0.5, 0.5],
    })
    expect(grid.gridBytes).toBe(grid.gridCells * 4)
    expect(() =>
      bakePointDistanceGrid(new Float32Array([NaN, 0, 0, 1]), 0.05, 0.0125),
    ).toThrow('finite points')
  })

  it('reports separated cells and detects an unsupported off-centre base', () => {
    const positions = new Float32Array([
      0.02, 0.02, 0.02, 0, 0.02, 0.06, 0.02, 1, 0.42, 0.06, 0.02, 1, 0.46, 0.06,
      0.02, 1,
    ])
    const report = inspectCandidateMaterial(
      positions,
      0.04,
      { min: [0, 0, 0], max: [0.48, 0.08, 0.04] },
      () => 1,
    )
    expect(report.componentParticleCounts).toEqual([2, 2])
    expect(report.largestComponentFraction).toBe(0.5)
    expect(report.baseCellCount).toBe(1)
    expect(report.baseArea).toBe(0.0016)
    expect(report.centerSupported).toBe(false)
    expect(report.restVolume).toBe(4 * 0.04 ** 3)
  })

  it('uses the real compact quantized native density kernel for surface warnings', () => {
    const positions = new Float32Array([
      0.02, 0.02, 0.02, 1, 0.06, 0.02, 0.02, 1,
    ])
    const point = [0.04, 0.02, 0.02] as const,
      radius = 0.04 * MARCHING_GUMMY_RADIUS_SCALE
    const weight = 0.04 ** 3 / ((4 * Math.PI * radius ** 3) / 3)
    const oracle =
      (2 *
        Math.round(
          marchingGummyDensity(d.vec3f(0.02, 0, 0), radius, weight) *
            MARCHING_GUMMY_FIXED_SCALE,
        )) /
      MARCHING_GUMMY_FIXED_SCALE
    expect(candidateSolidDensity(point, positions, 0.04)).toBe(oracle)
    expect(candidateSolidDensity([1, 1, 1], positions, 0.04)).toBe(0)
  })

  it.each(['menger-rook', 'sierpinski-bishop'] as const)(
    'bakes %s as actual finite material without editing its native source',
    (id) => {
      const source = candidate(id),
        before = JSON.stringify(source)
      const solid = buildCandidateSolid(source)
      expect(JSON.stringify(source)).toBe(before)
      expect(solid.spacing).toBe(0.04)
      expect(solid.report.particleCount).toBe(solid.restPositions.length / 4)
      expect(solid.report.restVolume).toBe(
        solid.report.particleCount * 0.04 ** 3,
      )
      expect(
        solid.report.componentParticleCounts.reduce(
          (sum, count) => sum + count,
          0,
        ),
      ).toBe(solid.report.particleCount)
      expect(solid.report.baseCellCount).toBeGreaterThan(0)
      expect(solid.report.componentCount).toBe(1)
      expect(solid.report.particleCount).toBe(
        id === 'menger-rook' ? 23472 : 3662,
      )
      expect(solid.bounds.min[1]).toBe(0)
      expect(solid.bounds.max[1]).toBeLessThanOrEqual(1.88)
      expect(solid.report.quantizationError).toBeCloseTo(
        (Math.sqrt(3) * 0.0125) / 2,
        12,
      )
      const cloud = samplePawnCloud(candidateRenderFlame(source), {
        count: 1200,
        burnIn: 64,
        seed: source.solid!.seed,
      })
      let covered = 0
      for (let i = 0; i < cloud.points.length; i += 4)
        if (
          solid.field([
            cloud.points[i]!,
            cloud.points[i + 1]!,
            cloud.points[i + 2]!,
          ]) <= 0
        )
          covered++
      expect(covered / cloud.count).toBeGreaterThan(0.99)
      for (let i = 0; i < solid.restPositions.length; i += 4) {
        expect(
          solid.field([
            solid.restPositions[i]!,
            solid.restPositions[i + 1]!,
            solid.restPositions[i + 2]!,
          ]),
        ).toBeLessThanOrEqual(0.000001)
        expect(solid.restPositions[i + 3]).toBe(
          solid.restPositions[i + 1]! < 0.22 ? 0 : 1,
        )
      }
    },
    30_000,
  )

  it.each([
    {
      thickness: 0.025,
      count: 2068,
      base: 531,
      volume: 0.132352,
      density: 0.301025390625,
    },
    {
      thickness: 0.035,
      count: 2721,
      base: 605,
      volume: 0.174144,
      density: 0.5091552734375,
    },
    {
      thickness: 0.04,
      count: 3024,
      base: 634,
      volume: 0.193536,
      density: 0.5093994140625,
    },
  ])(
    'keeps thinner bishop material connected while exposing a closed kernel gap at $thickness metres',
    ({ thickness, count, base, volume, density }) => {
      const source = candidate('sierpinski-bishop')
      source.solid!.thickness = thickness
      const solid = buildCandidateSolid(source)
      const centre = [0, 1.2925, -0.08] as const
      expect(solid.report.centerSupported).toBe(true)
      expect(solid.report.componentCount).toBe(1)
      expect(solid.report.particleCount).toBe(count)
      expect(solid.report.baseCellCount).toBe(base)
      expect(solid.report.restVolume).toBeCloseTo(volume, 12)
      expect(solid.field(centre)).toBeGreaterThan(0)
      expect(
        candidateSolidDensity(centre, solid.restPositions, solid.spacing),
      ).toBe(density)
    },
    30_000,
  )

  it('preserves exact placement and geometry across palette/label changes', () => {
    const source = candidate('sierpinski-bishop')
    source.placement.offset = [0.2, 0.2, -0.3]
    const original = buildCandidateSolid(source, { pinHeight: 0 })
    const recoloured = {
      ...source,
      name: 'Renamed source',
      source: {
        ...source.source,
        flame: buildFigurineStudy('sierpinski-bishop', 'dark'),
      },
    }
    const alternate = buildCandidateSolid(recoloured, { pinHeight: 0 })
    expect(alternate.restPositions).toEqual(original.restPositions)
    expect(alternate.geometryKey).toBe(original.geometryKey)
    expect(original.report.sourceBounds.min[1]).toBeGreaterThan(0.19)
    expect(original.report.baseCellCount).toBe(0)
    expect(original.report.warnings).toContain(
      'No occupied material cell touches the ground plane.',
    )
    expect(
      [...original.restPositions]
        .filter((_, index) => index % 4 === 3)
        .every((value) => value === 1),
    ).toBe(true)
  }, 30_000)

  it('explicitly declines unsupported nonlinear, layered, custom, flat, blended and uncertified maps', () => {
    const source = candidate()
    expect(candidateSolidSupportError(source)).toBeUndefined()
    const first = Object.values(source.source.flame.transforms)[0]!
    Object.values(first.variations)[0]!.type = 'blur3D'
    expect(candidateSolidSupportError(source)).toContain('linear3D')
    expect(() => buildCandidateSolid(source)).toThrow('linear3D')
    const flat = candidate()
    flat.source.flame.renderSettings.dimensions = 2
    expect(candidateSolidSupportError(flat)).toContain('native 3D')
    const blended = candidate()
    blended.source.flame.renderSettings.blendFlame =
      buildFigurineStudy('menger-rook')
    expect(candidateSolidSupportError(blended)).toContain('Blended')
    const custom = candidate()
    custom.source.customVariations = [{} as never]
    expect(candidateSolidSupportError(custom)).toContain('Custom')
    const layered = candidate()
    layered.source.flame.layers = [{} as never]
    expect(candidateSolidSupportError(layered)).toContain('layers')
    const expanded = candidate()
    Object.values(expanded.source.flame.transforms)[0]!.postAffine = {
      a: 1.1,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 1.1,
      g: 0,
      h: 0,
      i: 0,
      j: 0,
      k: 1.1,
      l: 0,
    }
    expect(candidateSolidSupportError(expanded)).toContain(
      'certified contractive',
    )
    const legacy = { ...candidate(), version: 1 as const, solid: undefined }
    expect(candidateSolidSupportError(legacy)).toContain('version-2')
  })

  it('validates a direct finite request before allocating or sampling', () => {
    const source = candidate()
    expect(() =>
      buildCandidateSolid({
        ...source,
        solid: { ...source.solid!, thickness: NaN },
      }),
    ).toThrow('thickness')
    expect(() => buildCandidateSolid(source, { pinHeight: Infinity })).toThrow(
      'pin height',
    )
  })
})
