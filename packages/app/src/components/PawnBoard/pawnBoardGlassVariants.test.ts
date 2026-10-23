/** Exact shell reconstruction and bounded, deterministic motion clusters for capture fragments. */
import { describe, expect, it } from 'vitest'
import { sampleFlameFigurineCloud } from '@/flame/chess/flameFigurineCloud'
import { buildFractalChessFlame } from '@/flame/chess/fractalChessCollections'
import { buildFractalStudyGlass, getFractalStudyGlassRole, } from '@/flame/chess/fractalStudyGlass'
import { packVariantGlassFragments } from './pawnBoardGlassVariants'

describe('exact native glass fragments', () => {
  it.each(['wild-canopy', 'tidal-relics', 'lattice-court'])(
    '%s preserves its triangles and normals in at most 96 deterministic clusters',
    (collection) => {
      const role = getFractalStudyGlassRole(collection)!
      const points = sampleFlameFigurineCloud(
        buildFractalChessFlame(collection, role),
        { count: 2000, seed: 42 },
      ).points
      const { vertices } = buildFractalStudyGlass(collection, points)
      const before = vertices.slice()
      const fragments = packVariantGlassFragments(vertices)
      expect(fragments).toEqual(packVariantGlassFragments(vertices))
      expect(vertices).toEqual(before)
      expect(fragments.length / 15).toBe(vertices.length / 6)
      expect(fragments.every(Number.isFinite)).toBe(true)
      const clusters = new Set<string>()
      let reconstructionError = 0
      for (let vertex = 0; vertex < vertices.length / 6; vertex++) {
        const offset = vertex * 15
        for (let axis = 0; axis < 3; axis++) {
          reconstructionError = Math.max(
            reconstructionError,
            Math.abs(
              fragments[offset + axis]! +
                fragments[offset + 6 + axis]! -
                vertices[vertex * 6 + axis]!,
            ),
          )
          expect(fragments[offset + 3 + axis]).toBe(
            vertices[vertex * 6 + 3 + axis],
          )
        }
        const motion = fragments.subarray(offset + 6, offset + 15)
        clusters.add(motion.join(','))
        // All corners of each original triangle move rigidly together.
        const triangleStart = Math.floor(vertex / 3) * 45
        expect(motion).toEqual(
          fragments.subarray(triangleStart + 6, triangleStart + 15),
        )
        const speed = Math.hypot(
          fragments[offset + 9]!,
          fragments[offset + 11]!,
        )
        expect(speed).toBeGreaterThanOrEqual(0.54)
        expect(speed).toBeLessThanOrEqual(1.36)
        expect(fragments[offset + 10]).toBeGreaterThanOrEqual(0.39)
        expect(fragments[offset + 10]).toBeLessThanOrEqual(1.31)
        expect(
          Array.from(fragments.subarray(offset + 12, offset + 15)).every(
            (value) => Math.abs(value) <= 3,
          ),
        ).toBe(true)
      }
      expect(reconstructionError).toBeLessThan(2e-7)
      expect(clusters.size).toBeGreaterThan(24)
      expect(clusters.size).toBeLessThanOrEqual(96)
    },
  )
})
