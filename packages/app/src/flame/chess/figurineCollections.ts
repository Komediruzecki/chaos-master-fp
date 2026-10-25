/** Shared comparison catalog and native dispatch for flame experiments and geometric studies. */
import { buildBlueBranchPawnFlame } from './blueBranchPawnFlame'
import { buildFigurineStudy, FIGURINE_STUDIES } from './figurineStudies'
import { buildFlameFigurine, FLAME_FIGURINES } from './flameFigurines'
import type { FigurineStudyId } from './figurineStudies'
import type { FlameFigurineId } from './flameFigurines'
import type { PawnSide } from './pawnFlame'

export type FigurineId = FlameFigurineId | FigurineStudyId | 'blue-branch-pawn'
export type FigurineCollectionId =
  | 'flame-experiments'
  | 'geometric-studies'
  | 'glass-cores'
const BLUE_BRANCH_PAWN = {
  id: 'blue-branch-pawn' as const,
  name: 'Blue branching pawn',
  piece: 'pawn' as const,
  family: 'Branching roots and recursive fern crown',
  description:
    'A narrow branching stem opens into blue fronds with smaller forks inside each one. Dark gaps separate the branches beneath the glass.',
  fractureHint:
    'Keep related branches together as the core breaks, using their shared recursive history to define the fragments.',
}
export type Figurine =
  | (typeof FLAME_FIGURINES)[number]
  | (typeof FIGURINE_STUDIES)[number]
  | typeof BLUE_BRANCH_PAWN

export type FigurineCollection = {
  id: FigurineCollectionId
  name: string
  description: string
  figurines: readonly Figurine[]
  paletteLegend: string
  palettes: readonly { id: PawnSide; name: string }[]
}

export const FIGURINE_COLLECTIONS: readonly FigurineCollection[] =
  Object.freeze([
    {
      id: 'flame-experiments',
      name: 'Flame experiments',
      description:
        'Mixed forms and nonlinear maps give these three pieces ribbons, branching details and several colors. Compare their silhouettes and try both palettes.',
      figurines: FLAME_FIGURINES,
      paletteLegend: 'Choose a palette',
      palettes: [
        { id: 'light', name: 'Authored' },
        { id: 'dark', name: 'Alternate' },
      ],
    },
    {
      id: 'geometric-studies',
      name: 'Geometric studies',
      description:
        'Four silhouettes built from recursive geometric maps. Compare their structure before choosing the next piece to develop.',
      figurines: FIGURINE_STUDIES,
      paletteLegend: 'Choose a side',
      palettes: [
        { id: 'light', name: 'Frost' },
        { id: 'dark', name: 'Ember' },
      ],
    },
    {
      id: 'glass-cores',
      name: 'Glass cores',
      description:
        'Inspect the branching pawn without its enclosure. The same native recipe grows the core inside the glass pawn on the board.',
      figurines: [BLUE_BRANCH_PAWN],
      paletteLegend: 'Choose a side',
      palettes: [
        { id: 'light', name: 'Frost' },
        { id: 'dark', name: 'Ember' },
      ],
    },
  ])

export function getFigurineCollection(
  id: FigurineCollectionId,
): FigurineCollection {
  return FIGURINE_COLLECTIONS.find((collection) => collection.id === id)!
}

function isFlameFigurineId(id: FigurineId): id is FlameFigurineId {
  return FLAME_FIGURINES.some((figurine) => figurine.id === id)
}

export function buildFigurine(id: FigurineId, side: PawnSide = 'light') {
  if (id === 'blue-branch-pawn') return buildBlueBranchPawnFlame({ side })
  return isFlameFigurineId(id)
    ? buildFlameFigurine(id, side)
    : buildFigurineStudy(id, side)
}
