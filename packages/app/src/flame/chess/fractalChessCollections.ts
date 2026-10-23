/** Native fractal art studies, kept separate from accepted playable material snapshots. */
import { fitArtFlame, nativeArtFlame } from './fractalChessMaps'
import { latticeMaps } from './fractalLatticeMaps'
import { organicMaps } from './fractalOrganicMaps'
import { tidalMaps } from './fractalTidalMaps'
import type { FlameDescriptor } from '../schema/flameSchema'
import type { ChessCandidateRole } from './chessCandidate'
import type { PawnSide } from './pawnFlame'

export type FractalChessCollectionId =
  | 'lattice-court'
  | 'tidal-relics'
  | 'wild-canopy'

type Piece = { role: ChessCandidateRole; name: string; description: string }
type Collection = {
  id: FractalChessCollectionId
  name: string
  description: string
  accent: string
  pieces: readonly Piece[]
}

export const FRACTAL_CHESS_COLLECTIONS: readonly Collection[] = [
  {
    id: 'lattice-court',
    name: 'Lattice Court',
    accent: '#9edbea',
    description: 'Pierced towers, folded crystals and open geometric lace.',
    pieces: [
      {
        role: 'pawn',
        name: 'Tetra seed',
        description:
          'A compact tetrahedral lattice. Its smallest cells repeat the entire form.',
      },
      {
        role: 'rook',
        name: 'Window tower',
        description:
          'A pierced square tower with openings repeated through its depth.',
      },
      {
        role: 'knight',
        name: 'Folded wing',
        description:
          'An asymmetric folded attractor with a forward sweep and nested edges.',
      },
      {
        role: 'bishop',
        name: 'Diamond spire',
        description:
          'A tall faceted lattice with a narrow, pointed silhouette.',
      },
      {
        role: 'queen',
        name: 'Star lace',
        description:
          'A radial crown whose smaller stars preserve the open centre.',
      },
      {
        role: 'king',
        name: 'Axis citadel',
        description:
          'An upright recursive structure, broad through the middle and clearly taller than its court.',
      },
    ],
  },
  {
    id: 'tidal-relics',
    name: 'Tidal Relics',
    accent: '#b9b0fa',
    description:
      'Coiled shells, curling crests and ribbons folded into themselves.',
    pieces: [
      {
        role: 'pawn',
        name: 'Pearl coil',
        description:
          'A small coiled shell. The inner scroll carries the same branching detail as its outer edge.',
      },
      {
        role: 'rook',
        name: 'Tide well',
        description:
          'Two inward curls frame a broad opening above a low, rippled foot.',
      },
      {
        role: 'knight',
        name: 'Breaking crest',
        description:
          'An unequal pair of scrolls forms a directional crest with a hooked tail.',
      },
      {
        role: 'bishop',
        name: 'Split current',
        description:
          'A bifurcating ribbon with nested gaps between its two rising tips.',
      },
      {
        role: 'queen',
        name: 'Spiral anemone',
        description:
          'Three rising spiral arms share a stem, with smaller curls nested along each edge.',
      },
      {
        role: 'king',
        name: 'Double helix',
        description:
          'Two root ribbons wind up a shared axis and taper toward one apex.',
      },
    ],
  },
  {
    id: 'wild-canopy',
    name: 'Wild Canopy',
    accent: '#b4db99',
    description:
      'Fern buds, antler coral and branching crowns grown by recurrence.',
    pieces: [
      {
        role: 'pawn',
        name: 'Fern bud',
        description:
          'A compact folded leaf. Fine branches repeat down to its smallest visible leaflets.',
      },
      {
        role: 'rook',
        name: 'Antler coral',
        description:
          'A broad fan coral with open branch gaps and a short central leader.',
      },
      {
        role: 'knight',
        name: 'Bent frond',
        description:
          'A curling fern spine bends the entire silhouette forward.',
      },
      {
        role: 'bishop',
        name: 'Cleft leaf',
        description:
          'Paired self-similar wings leave an open cleft between their tips.',
      },
      {
        role: 'queen',
        name: 'Petal crown',
        description:
          'A five-way botanical rosette with space between its rising branches.',
      },
      {
        role: 'king',
        name: 'Canopy elder',
        description:
          'A tall four-way tree with a continuing central leader and a fine branching canopy.',
      },
    ],
  },
]

export function getFractalChessCollection(id: string): Collection {
  const collection = FRACTAL_CHESS_COLLECTIONS.find((entry) => entry.id === id)
  if (!collection) throw new Error(`Unknown fractal collection: ${id}`)
  return collection
}

const heights: Record<ChessCandidateRole, number> = {
  pawn: 1.15,
  rook: 1.5,
  knight: 1.85,
  bishop: 1.95,
  queen: 2.12,
  king: 2.35,
}
const widths: Record<ChessCandidateRole, number> = {
  pawn: 0.92,
  rook: 1.23,
  knight: 1.25,
  bishop: 1.1,
  queen: 1.3,
  king: 1.26,
}
type Palette = readonly (readonly [number, number])[]
const palettes: Record<string, Record<PawnSide, Palette>> = {
  'lattice-court': {
    light: [
      [-0.09, -0.11],
      [-0.1, -0.035],
      [-0.035, -0.06],
    ],
    dark: [
      [0.16, 0.07],
      [0.09, 0.12],
      [0.14, -0.015],
    ],
  },
  'tidal-relics': {
    light: [
      [-0.1, -0.075],
      [0.055, -0.16],
      [-0.07, -0.03],
    ],
    dark: [
      [0.15, 0.08],
      [0.04, 0.14],
      [0.18, 0.01],
    ],
  },
  'wild-canopy': {
    light: [
      [-0.14, 0.09],
      [-0.12, 0.015],
      [-0.045, 0.12],
    ],
    dark: [
      [0.16, -0.12],
      [0.08, -0.16],
      [0.16, 0.035],
    ],
  },
}

/** All pieces in one role reuse an exact geometry; side colour never alters the maps. */
export function buildFractalChessFlame(
  id: string,
  role: ChessCandidateRole,
  side: PawnSide = 'light',
): FlameDescriptor {
  const collection = getFractalChessCollection(id)
  const piece = collection.pieces.find((entry) => entry.role === role)
  if (!piece) throw new Error(`Unknown chess role: ${role}`)
  const maps =
    id === 'lattice-court'
      ? latticeMaps(role)
      : id === 'tidal-relics'
        ? tidalMaps(role)
        : organicMaps(role)
  const flame = nativeArtFlame(
    `${collection.name}: ${piece.name}`,
    piece.description,
    maps,
    palettes[id]![side],
  )
  return fitArtFlame(
    flame,
    widths[role],
    heights[role],
    Math.min(1.16, widths[role]),
  )
}
