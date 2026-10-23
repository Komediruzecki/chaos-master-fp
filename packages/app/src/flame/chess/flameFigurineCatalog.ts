/** Names and design descriptions for the authored experimental flame figurines. */
export type FlameFigurineId = 'aurora-queen' | 'ember-bishop' | 'tidal-knight'
export type FlameFigurine = {
  id: FlameFigurineId
  name: string
  piece: 'queen' | 'bishop' | 'knight'
  family: string
  description: string
  fractureHint: string
}

export const FLAME_FIGURINES: readonly FlameFigurine[] = Object.freeze([
  {
    id: 'aurora-queen',
    name: 'Aurora queen',
    piece: 'queen',
    family: 'Woven sinusoidal flame and curled corolla',
    description:
      'Indigo coral roots support two turquoise woven currents and a gold crown of curled flame petals.',
    fractureHint:
      'A future fracture could unravel the woven stem into strands, then peel apart the curled crown.',
  },
  {
    id: 'ember-bishop',
    name: 'Ember bishop',
    piece: 'bishop',
    family: 'Barnsley fern mantle and split curl flame',
    description:
      'A plum rosette carries an orange fern of repeated branching fronds and a split gold flame mitre.',
    fractureHint:
      'A future fracture could separate the fern at branch junctions and divide the curled mitre along its cleft.',
  },
  {
    id: 'tidal-knight',
    name: 'Tidal knight',
    piece: 'knight',
    family: 'Swirling current and curl-grown fins',
    description:
      'Cyan roots rise into a deep blue flowing neck, with violet fins and a curled horse head reaching forward.',
    fractureHint:
      'A future fracture could strip the fins into ribbons before the neck separates into shorter currents.',
  },
])
