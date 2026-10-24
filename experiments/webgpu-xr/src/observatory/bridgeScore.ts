// A short earned D-centered answer settles Tideweave's D-F-B-A crossing without changing its target motif.
import type { TraceResolutionNote } from '../almanac/motifAudio'
import type { BridgePhrase } from './bridgePhrases'

/** A answers the player's last note, then three soft D octaves settle home. */
export const BRIDGE_RESOLUTION: readonly TraceResolutionNote[] = [
  { midi: 69, offset: 0, duration: 0.24, gain: 0.03 },
  { midi: 50, offset: 0.2, duration: 0.7, gain: 0.023 },
  { midi: 62, offset: 0.2, duration: 0.72, gain: 0.037 },
  { midi: 74, offset: 0.22, duration: 0.58, gain: 0.012 },
]

export const BRIDGE_RESOLUTION_SECONDS = Math.max(
  ...BRIDGE_RESOLUTION.map((note) => note.offset + note.duration + 0.01),
)

/** Each reprise answers its own final note before returning to the same D home. */
export function bridgeResolutionFor(
  phrase: BridgePhrase,
): readonly TraceResolutionNote[] {
  return BRIDGE_RESOLUTION.map((note, index) =>
    index === 0 ? { ...note, midi: phrase.motif.notes.at(-1)!.midi } : note,
  )
}
