// Pitch follows ribbon height exactly at each authored note, independently of scoring or input device.
import { BRIDGE_MOTIF, BRIDGE_TARGET } from './encounter'

const pitches = BRIDGE_TARGET.map((point, index) => ({
  height: point[1],
  midi: BRIDGE_MOTIF.notes[index].midi,
})).sort((a, b) => a.height - b.height)

export function pitchForTraceHeight(value: number): number | null {
  if (!Number.isFinite(value)) return null
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
