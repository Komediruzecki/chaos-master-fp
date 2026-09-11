import { parseFlameEnvelope } from '@/utils/flameImport'
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/utils/storage'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { ParsedFlame } from '@/utils/flameImport'
import type { TimelineTrack } from '@/utils/timeline'

/**
 * The flame the app was holding when it went to the background.
 *
 * The editor's own autosave (hooks/useWorkspaceAutosave.ts) reaches Recents
 * on pagehide and at every load boundary - but a WebView the OS force-stops
 * never fires pagehide, and both platforms force-stop without warning. Pause
 * is the last moment a native app is told about, so the flame goes here too
 * and the next cold start offers it back. Folding the two into one path is
 * still open.
 *
 * The stored value is the envelope `utils/flameImport` already reads, so a
 * draft is validated on the way back in exactly like an imported file: a
 * flame written by an older build that no longer validates is dropped rather
 * than loaded half-formed.
 */
export const DRAFT_KEY = 'chaos-master-draft'

const signature = (
  flame: FlameDescriptor,
  tracks?: readonly TimelineTrack[],
): string => JSON.stringify({ flame, tracks: tracks ?? [] })

/**
 * What the workspace loaded, or last came back to. A pause with nothing
 * changed since then is not worth a draft: Android fires pause for every
 * share sheet and permission dialog, so an untouched default flame would
 * otherwise be stored on the first background and offered back on every cold
 * start after it, over whatever the user opened the app for.
 */
let cleanSignature: string | undefined

/** Marks the current state as saved: what a pause may ignore. */
export function markDraftBaseline(
  flame: FlameDescriptor,
  tracks?: readonly TimelineTrack[],
): void {
  cleanSignature = signature(flame, tracks)
}

export function saveDraft(
  flame: FlameDescriptor,
  tracks?: readonly TimelineTrack[],
): void {
  if (signature(flame, tracks) === cleanSignature) {
    // Nothing unsaved, so nothing to come back to - and a draft left from an
    // earlier edit that has since been undone would outlive the work.
    clearDraft()
    return
  }
  const envelope = {
    flame,
    savedAt: Date.now(),
    ...(tracks && tracks.length > 0 ? { animation: { tracks } } : {}),
  }
  if (!safeSetItem(DRAFT_KEY, JSON.stringify(envelope))) {
    // The safety net is gone and there is nobody to tell at pause time, so
    // at least leave the reason somewhere rather than failing silently.
    console.warn(
      '[draft] storage refused the draft; this session is not backed up',
    )
  }
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

export type DraftAction = 'restore' | 'clear' | 'ignore'

/**
 * What a launch should do with the draft.
 *
 * Native only: nothing writes a draft on the web, where a tab is not
 * force-stopped from under the user (MainWorkspace registers the pause hook
 * behind IS_NATIVE).
 *
 * The welcome screen is deliberately not an input. It is not a first run: it
 * shows on every launch until the user ticks "Don't show again", and the
 * workspace is mounted behind it, so a restored flame is waiting once they
 * enter. A link that carries its own flame wins instead, and then the draft
 * is dropped rather than left lying for a later, unrelated session.
 */
export function draftAction(input: {
  native: boolean
  search: string
}): DraftAction {
  if (!input.native) return 'ignore'
  return hasSharePayload(input.search) ? 'clear' : 'restore'
}

/**
 * A link that carries its own flame (`?s=`, `?flame=`) or variation (`?cv=`).
 * Restoring the draft over it would replace what the link was opened for.
 */
export function hasSharePayload(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.has('s') || params.has('flame') || params.has('cv')
}
