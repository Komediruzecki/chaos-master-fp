// Pitch follows ribbon height exactly at each authored note, independently of scoring or input device.
import { BRIDGE_PHRASES, FIRST_BRIDGE_PHRASE } from './bridgePhrases'
import type { BridgePhrase } from './bridgePhrases'

function pitchMap(phrase: BridgePhrase) {
  return phrase.target
    .map((point, index) => ({
      height: point[1],
      midi: phrase.motif.notes[index].midi,
    }))
    .sort((a, b) => a.height - b.height)
}

const maps = new WeakMap(
  BRIDGE_PHRASES.map((phrase) => [phrase, pitchMap(phrase)]),
)

export function pitchForTraceHeight(
  value: number,
  phrase: BridgePhrase = FIRST_BRIDGE_PHRASE,
): number | null {
  if (!Number.isFinite(value)) return null
  let pitches = maps.get(phrase)
  if (!pitches) {
    pitches = pitchMap(phrase)
    maps.set(phrase, pitches)
  }
  if (value <= pitches[0].height) return pitches[0].midi
  for (let index = 1; index < pitches.length; index++) {
    const lower = pitches[index - 1]
    const upper = pitches[index]
    if (value <= upper.height) {
      const progress = (value - lower.height) / (upper.height - lower.height)
      return lower.midi + (upper.midi - lower.midi) * progress
    }
  }
  return pitches.at(-1)!.midi
}
