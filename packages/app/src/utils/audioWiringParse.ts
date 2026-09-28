// Reads the audio wiring a shared or stored flame carries. A wiring that does
// not fit the wiring schema is dropped on its own: it never costs the flame it
// came with.
import { AudioMapping } from '@/flame/schema/audioWiring'
import * as v from '@/valibot'

/** The carried wiring when it fits the wiring schema, else undefined. */
export function parseAudioWiring(value: unknown): AudioMapping | undefined {
  if (value === undefined) return undefined
  const parsed = v.safeParse(AudioMapping, value)
  // Pinned at the call site: valibot's inferred output widens in ways that
  // differ between a local typecheck and CI.
  return parsed.success ? parsed.output : undefined
}
