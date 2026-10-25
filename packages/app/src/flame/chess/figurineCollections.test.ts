/** Collection dispatch preserves every native recipe and each collection's palette meanings. */
import { describe, expect, it } from 'vitest'
import { buildBlueBranchPawnFlame } from './blueBranchPawnFlame'
import { buildFigurine, FIGURINE_COLLECTIONS, getFigurineCollection, } from './figurineCollections'
import { buildFigurineStudy, FIGURINE_STUDIES } from './figurineStudies'
import { buildFlameFigurine, FLAME_FIGURINES } from './flameFigurines'

describe('figurineCollections', () => {
  it('keeps the existing geometric catalog alongside three flame experiments', () => {
    expect(FIGURINE_COLLECTIONS.map((collection) => collection.id)).toEqual([
      'flame-experiments',
      'geometric-studies',
      'glass-cores',
    ])
    expect(getFigurineCollection('flame-experiments').figurines).toBe(
      FLAME_FIGURINES,
    )
    expect(
      getFigurineCollection('flame-experiments').figurines.map(
        (figurine) => figurine.id,
      ),
    ).toEqual(['aurora-queen', 'ember-bishop', 'tidal-knight'])
    expect(getFigurineCollection('geometric-studies').figurines).toBe(
      FIGURINE_STUDIES,
    )
    expect(
      getFigurineCollection('geometric-studies').figurines.map(
        (figurine) => figurine.id,
      ),
    ).toEqual([
      'lattice-pawn',
      'menger-rook',
      'sierpinski-bishop',
      'branching-knight',
    ])
  })

  it('labels the same native side parameter appropriately for each collection', () => {
    expect(getFigurineCollection('flame-experiments').palettes).toEqual([
      { id: 'light', name: 'Authored' },
      { id: 'dark', name: 'Alternate' },
    ])
    expect(getFigurineCollection('geometric-studies').palettes).toEqual([
      { id: 'light', name: 'Frost' },
      { id: 'dark', name: 'Ember' },
    ])
    expect(buildFigurine('aurora-queen')).toEqual(
      buildFlameFigurine('aurora-queen', 'light'),
    )
  })

  for (const side of ['light', 'dark'] as const) {
    it(`dispatches the branching glass core with the ${side} palette`, () => {
      expect(buildFigurine('blue-branch-pawn', side)).toEqual(
        buildBlueBranchPawnFlame({ side }),
      )
    })
    it.each(FLAME_FIGURINES)(
      `dispatches $id with the ${side} palette to its nonlinear recipe`,
      (figurine) => {
        expect(buildFigurine(figurine.id, side)).toEqual(
          buildFlameFigurine(figurine.id, side),
        )
      },
    )
    it.each(FIGURINE_STUDIES)(
      `dispatches $id with the ${side} side to its original geometric recipe`,
      (figurine) => {
        expect(buildFigurine(figurine.id, side)).toEqual(
          buildFigurineStudy(figurine.id, side),
        )
      },
    )
  }
})
