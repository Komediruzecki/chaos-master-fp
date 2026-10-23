/** Exercise authored collections through the same native sampler used by the board worker. */
import { describe, expect, it } from 'vitest'
import { validateFlame3D } from '../schema/flameSchema'
import { sampleFlameFigurineCloud } from './flameFigurineCloud'
import { buildFractalChessFlame, FRACTAL_CHESS_COLLECTIONS, } from './fractalChessCollections'
import type { FlameDescriptor } from '../schema/flameSchema'

const roles = ['bishop', 'king', 'knight', 'pawn', 'queen', 'rook']
const studies = FRACTAL_CHESS_COLLECTIONS.flatMap((collection) =>
  collection.pieces.map((piece) => ({
    collection: collection.id,
    role: piece.role,
  })),
)

function geometryRecipe(flame: FlameDescriptor) {
  // Ignore colour and the display fit: a recoloured or resized copy of a
  // previous recurrence is not another authored shape.
  return JSON.stringify(
    Object.values(flame.transforms).map((map) => ({
      probability: map.probability,
      preAffine: map.preAffine,
      postAffine: map.postAffine,
      walkGroup: map.walkGroup,
      variations: map.variations,
    })),
  )
}

describe('native fractal chess art collections', () => {
  it('offers three complete role sets with distinct recurrences, not only palette or size swaps', () => {
    expect(FRACTAL_CHESS_COLLECTIONS).toHaveLength(3)
    expect(
      new Set(FRACTAL_CHESS_COLLECTIONS.map((collection) => collection.id))
        .size,
    ).toBe(3)
    for (const collection of FRACTAL_CHESS_COLLECTIONS) {
      expect(collection.pieces.map((piece) => piece.role).sort()).toEqual(roles)
    }
    const recipes = studies.map(({ collection, role }) =>
      geometryRecipe(buildFractalChessFlame(collection, role, 'light')),
    )
    expect(new Set(recipes).size).toBe(18)
  }, 15_000)

  it.each(studies)(
    '$collection / $role fits its board square on independent production samples',
    ({ collection, role }) => {
      const flame = buildFractalChessFlame(collection, role, 'light')
      // These are deliberately different from the seed/count used by the fit.
      // This catches escaped branches without pretending a sample proves the
      // complete mathematical attractor is bounded.
      for (const seed of [42, 0x9e3779b9]) {
        const cloud = sampleFlameFigurineCloud(flame, {
          count: 12_000,
          seed,
          burnIn: 128,
          lightness: 0.64,
        })
        expect(cloud.count).toBe(12_000)
        expect(cloud.points.every(Number.isFinite)).toBe(true)
        expect(
          cloud.colors.every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1,
          ),
        ).toBe(true)
        expect(cloud.bounds.min[0]).toBeGreaterThanOrEqual(-0.8)
        expect(cloud.bounds.max[0]).toBeLessThanOrEqual(0.8)
        expect(cloud.bounds.min[2]).toBeGreaterThanOrEqual(-0.8)
        expect(cloud.bounds.max[2]).toBeLessThanOrEqual(0.8)
        expect(cloud.bounds.min[1]).toBeGreaterThanOrEqual(0)
        expect(cloud.bounds.max[1]).toBeLessThanOrEqual(2.5)
        // An accidental zero-scale affine must not pass the containment checks.
        for (const axis of [0, 1, 2]) {
          expect(
            cloud.bounds.max[axis]! - cloud.bounds.min[axis]!,
          ).toBeGreaterThan(0.12)
        }
      }
    },
  )

  it.each(studies)(
    '$collection / $role changes side colours without changing geometry',
    ({ collection, role }) => {
      const light = buildFractalChessFlame(collection, role, 'light')
      const dark = buildFractalChessFlame(collection, role, 'dark')
      const options = { count: 4096, seed: 8317, lightness: 0.64 }
      const lightCloud = sampleFlameFigurineCloud(light, options)
      const darkCloud = sampleFlameFigurineCloud(dark, options)
      expect(geometryRecipe(light)).toBe(geometryRecipe(dark))
      expect(lightCloud.points).toEqual(darkCloud.points)
      expect(lightCloud.colors).not.toEqual(darkCloud.colors)
    },
  )

  it.each(studies)(
    '$collection / $role survives the downloadable native JSON round trip',
    ({ collection, role }) => {
      const flame = buildFractalChessFlame(collection, role, 'light')
      const restored = validateFlame3D(JSON.parse(JSON.stringify(flame)))
      const options = { count: 4096, seed: 4242, lightness: 0.64 }
      const before = sampleFlameFigurineCloud(flame, options)
      const after = sampleFlameFigurineCloud(restored, options)
      expect(after.points).toEqual(before.points)
      expect(after.colors).toEqual(before.colors)
      expect(restored.finalTransform).toEqual(flame.finalTransform)
      // JSON canonicalizes -0 offsets to 0; sampled geometry above must still
      // match exactly, while the authored maps must preserve their JSON form.
      expect(JSON.stringify(restored.transforms)).toBe(
        JSON.stringify(flame.transforms),
      )
    },
  )
})
