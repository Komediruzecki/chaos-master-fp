// Reads the wiring JSON a user pastes or loads into the wiring editor with the
// schema the flame and the commands use, and says in words what is wrong when
// it does not fit.
import { validateAudioMappingEntriesWithErrors } from '@/flame/schema/audioWiring'
import type { AudioMappingEntry } from '@/utils/audioAnalysis'

export type WiringImport =
  | { ok: true; mappings: AudioMappingEntry[] }
  | { ok: false; error: string }

/** Complaints shown in full; any beyond these are only counted. */
const SHOWN_COMPLAINTS = 3

export function parseWiringImport(text: string): WiringImport {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `That is not JSON: ${reason}` }
  }
  const complaints: string[] = []
  const mappings = validateAudioMappingEntriesWithErrors(data, (complaint) =>
    complaints.push(complaint),
  )
  if (mappings) return { ok: true, mappings }
  const hidden = complaints.length - SHOWN_COMPLAINTS
  const shown = complaints.slice(0, SHOWN_COMPLAINTS).join('; ')
  return {
    ok: false,
    error: `This wiring does not fit: ${shown}${hidden > 0 ? ` (and ${hidden} more)` : ''}`,
  }
}
