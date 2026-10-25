// Authored three-seal calls retain Glasswake's first motif while giving practice its own note order.
import type { AlmanacMotif } from '../almanac/catalog'

export type GlassPhraseId = 'first-light' | 'high-glint' | 'falling-light'

export interface GlassPhrase {
  readonly id: GlassPhraseId
  readonly title: string
  readonly description: string
  readonly notes: readonly { readonly midi: number; readonly name: string }[]
  readonly motif: AlmanacMotif
}

function phrase(
  id: GlassPhraseId,
  title: string,
  description: string,
  notes: GlassPhrase['notes'],
  tempo: number,
): GlassPhrase {
  return {
    id,
    title,
    description,
    notes,
    motif: {
      id: id === 'first-light' ? 'glasswake-three-seals' : `glasswake-${id}`,
      tonic: 'C',
      mode: 'Ionian',
      tempo,
      timbre: 'glass',
      notes: notes.map((note, beat) => ({
        midi: note.midi,
        beat,
        duration: beat === notes.length - 1 ? 1.1 : 0.7,
      })),
    },
  }
}

export const GLASS_PHRASES: readonly GlassPhrase[] = [
  phrase(
    'first-light',
    'First light',
    'Open C, E and G, one held note at a time.',
    [
      { midi: 60, name: 'C4' },
      { midi: 64, name: 'E4' },
      { midi: 67, name: 'G4' },
    ],
    82,
  ),
  phrase(
    'high-glint',
    'High glint',
    'Rise from C through G to the C above.',
    [
      { midi: 60, name: 'C4' },
      { midi: 67, name: 'G4' },
      { midi: 72, name: 'C5' },
    ],
    78,
  ),
  phrase(
    'falling-light',
    'Falling light',
    'Bring G down through E, then settle on C.',
    [
      { midi: 67, name: 'G4' },
      { midi: 64, name: 'E4' },
      { midi: 60, name: 'C4' },
    ],
    76,
  ),
]

export const FIRST_GLASS_PHRASE = GLASS_PHRASES[0]
