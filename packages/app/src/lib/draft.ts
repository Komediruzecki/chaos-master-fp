import { parseFlameEnvelope } from '@/utils/flameImport'
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/utils/storage'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { ParsedFlame } from '@/utils/flameImport'
import type { TimelineTrack } from '@/utils/timeline'

/**
 * The flame the app was holding when it went to the background.
 *
 * The editor has no autosave: everything the user makes lives in memory until
 * they export or save it. An OS that kills a backgrounded WebView - which both
 * platforms do, without warning - would take the session with it, so pause
 * writes the current flame here (lib/lifecycle.ts calls it) and the next cold
 * start offers it back.
 *
 * The stored value is the envelope `utils/flameImport` already reads, so a
 * draft is validated on the way back in exactly like an imported file: a
 * flame written by an older build that no longer validates is dropped rather
 * than loaded half-formed.
 */
export const DRAFT_KEY = 'chaos-master-draft'

export function saveDraft(
  flame: FlameDescriptor,
  tracks?: readonly TimelineTrack[],
): void {
  const envelope = {
    flame,
    savedAt: Date.now(),
    ...(tracks && tracks.length > 0 ? { animation: { tracks } } : {}),
  }
  safeSetItem(DRAFT_KEY, JSON.stringify(envelope))
}

export function readDraft(): ParsedFlame | undefined {
  const raw = safeGetItem(DRAFT_KEY)
  if (raw === null) return undefined
  try {
    return parseFlameEnvelope(JSON.parse(raw))
  } catch {
    // A half-written value (the OS killed the app mid-write) is not an error
    // worth showing: there is simply no draft.
    return undefined
  }
}

export function clearDraft(): void {
  safeRemoveItem(DRAFT_KEY)
}

/**
 * A link that carries its own flame (`?s=`, `?flame=`) or variation (`?cv=`).
 * Restoring the draft over it would replace what the link was opened for.
 */
export function hasSharePayload(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.has('s') || params.has('flame') || params.has('cv')
}
