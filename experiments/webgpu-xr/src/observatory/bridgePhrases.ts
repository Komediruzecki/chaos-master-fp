// Authored four-note reprises keep Tideweave's first crossing and saved world identity separate.
import type { AlmanacMotif } from '../almanac/catalog'

export type BridgePhraseId = 'first-crossing' | 'turning-tide' | 'homeward'

export interface BridgePhrase {
  readonly id: BridgePhraseId
  readonly title: string
  readonly description: string
  readonly motif: AlmanacMotif
  readonly target: readonly (readonly [number, number])[]
  readonly noteNames: readonly string[]
}

function motif(
  id: string,
  pitches: readonly number[],
  tempo: number,
): AlmanacMotif {
  return {
    id,
    tonic: 'D',
    mode: 'Dorian',
    tempo,
    timbre: 'reed',
    notes: pitches.map((midi, beat) => ({
      midi,
      beat,
      duration: beat === pitches.length - 1 ? 1.35 : 0.72,
    })),
  }
}

export const BRIDGE_PHRASES: readonly BridgePhrase[] = [
  {
    id: 'first-crossing',
    title: 'First crossing',
    description: 'Rise through D and F to B, then settle on A.',
    motif: motif('tideweave-bridge-four', [62, 65, 71, 69], 82),
    target: [
      [0.12, 0.78],
      [0.37, 0.56],
      [0.63, 0.16],
      [0.88, 0.32],
    ],
    noteNames: ['D', 'F', 'B', 'A'],
  },
  {
    id: 'turning-tide',
    title: 'Turning tide',
    description: 'Climb to A, dip to F, then reach the bright B.',
    motif: motif('tideweave-turning-tide', [62, 69, 65, 71], 86),
    target: [
      [0.12, 0.78],
      [0.37, 0.32],
      [0.63, 0.56],
      [0.88, 0.16],
    ],
    noteNames: ['D', 'A', 'F', 'B'],
  },
  {
    id: 'homeward',
    title: 'Homeward',
    description: 'Follow B down through A and F, returning to D.',
    motif: motif('tideweave-homeward', [71, 69, 65, 62], 76),
    target: [
      [0.12, 0.16],
      [0.37, 0.32],
      [0.63, 0.56],
      [0.88, 0.78],
    ],
    noteNames: ['B', 'A', 'F', 'D'],
  },
]

export const FIRST_BRIDGE_PHRASE = BRIDGE_PHRASES[0]
