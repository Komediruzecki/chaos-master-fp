import { parseFlameEnvelope } from '@/utils/flameImport'
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/utils/storage'
import { onAppPause } from './lifecycle'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { ParsedFlame } from '@/utils/flameImport'
import type { TimelineConfig, TimelineTrack } from '@/utils/timeline'

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

/**
 * Everything a draft is made of, in one shape.
 *
 * The baseline and the write take the same argument on purpose. They used to
 * take three positional parameters with the timeline's config last and
 * optional, and the workspace passed the flame and the tracks to both and the
 * config to neither: every draft came back at the hand-off's reset, and a
 * change to only the fps or the end frame read as no change at all, which
 * sent the write into the branch that deletes the draft.
 */
export interface DraftState {
  readonly flame: FlameDescriptor
  readonly tracks: readonly TimelineTrack[]
  readonly config: TimelineConfig
}

const signature = (state: DraftState): string =>
  JSON.stringify({
    flame: state.flame,
    tracks: state.tracks,
    config: state.config,
  })

/**
 * What the workspace loaded, or last came back to. A pause with nothing
 * changed since then is not worth a draft: Android fires pause for every
 * share sheet and permission dialog, so an untouched default flame would
 * otherwise be stored on the first background and offered back on every cold
 * start after it, over whatever the user opened the app for.
 */
let cleanSignature: string | undefined

/** Marks the current state as saved: what a pause may ignore. */
export function markDraftBaseline(state: DraftState): void {
  cleanSignature = signature(state)
}

export function saveDraft(state: DraftState): void {
  if (signature(state) === cleanSignature) {
    // Nothing unsaved, so nothing to come back to - and a draft left from an
    // earlier edit that has since been undone would outlive the work.
    clearDraft()
    return
  }
  const envelope = {
    flame: state.flame,
    savedAt: Date.now(),
    // The share link's shape, so one envelope reader serves both: the
    // config is what says how long the animation is and how fast it runs.
    // Written whether or not there are tracks, because the signature counts
    // the config either way: on a flame with no tracks a change to the fps
    // or the end frame was a change worth a draft, and the draft it asked
    // for was then written without it. The reader drops an empty track list
    // and reads the config beside it (utils/flameImport).
    animation: { tracks: state.tracks, config: state.config },
  }
  if (!safeSetItem(DRAFT_KEY, JSON.stringify(envelope))) {
    // The safety net is gone and there is nobody to tell at pause time, so
    // at least leave the reason somewhere rather than failing silently.
    console.warn(
      '[draft] storage refused the draft; this session is not backed up',
    )
  }
}

export interface DraftBackup {
  /**
   * Takes the baseline again: a load is a fresh starting point, not an edit,
   * so the flame a share link or the gallery just opened is not somebody's
   * unsaved work.
   */
  readonly markBaseline: () => void
  readonly dispose: () => void
}

/**
 * The background safety net, wired to one reader.
 *
 * The baseline and the pause write read the same snapshot, so the two cannot
 * drift apart the way two call sites in the workspace did. Native only: on
 * the web pause is `visibilitychange`, which fires on every tab switch, and
 * only the native build ever reads a draft back.
 */
export function installDraftBackup(input: {
  native: boolean
  read: () => DraftState
}): DraftBackup {
  if (!input.native) {
    return { markBaseline: () => undefined, dispose: () => undefined }
  }
  markDraftBaseline(input.read())
  return {
    markBaseline: () => {
      markDraftBaseline(input.read())
    },
    dispose: onAppPause(() => {
      saveDraft(input.read())
    }),
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
 * force-stopped from under the user (installDraftBackup is given the flag).
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
 * The draft a launch should adopt, if there is one.
 *
 * A restore deliberately leaves the value in storage. Reading it and clearing
 * it on the same tick lost the session: the flame lands behind the welcome
 * screen, and picking a starter flame from the grid overwrites it and resets
 * the workspace - while the restore has already ended in a fresh baseline, so
 * the flame counts as clean and nothing writes it back. Left where it is, the
 * next pause either overwrites the draft or clears it through the
 * clean-signature path, and a draft nobody adopted is offered again.
 */
export function draftForLaunch(input: {
  native: boolean
  search: string
}): ParsedFlame | undefined {
  const action = draftAction(input)
  if (action === 'ignore') return undefined
  if (action === 'clear') {
    clearDraft()
    return undefined
  }
  return readDraft()
}

/** Where the flame a hand-off carries came from. */
export type HandoffSource = 'user' | 'draft'

/**
 * Whether a hand-off is a fresh starting point for the workspace's two safety
 * nets - the editor's autosave and this draft.
 *
 * A flame the user picked is one: nothing about a gallery flame is unsaved the
 * moment it lands. A flame this launch restored from the draft slot is not.
 * It is unsaved work that has never reached Recents, and taking a baseline on
 * it made it count as saved: when the user then tapped a starter flame on the
 * welcome grid the autosave's flush wrote nothing, the hand-off's reset
 * dropped the restored flame from memory, and the very next pause - any share
 * sheet or app switch - matched the new baseline and took the branch that
 * deletes the draft. The work was gone from memory, from Recents and from
 * storage at once.
 *
 * Left unsaved, the flush that already runs at every hand-off puts it in
 * Recents on the way past, and the draft is only cleared once it has.
 */
export function handoffTakesBaseline(source: HandoffSource): boolean {
  return source !== 'draft'
}

/**
 * A link that carries its own flame (`?s=`, `?flame=`) or variation (`?cv=`).
 * Restoring the draft over it would replace what the link was opened for.
 */
export function hasSharePayload(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.has('s') || params.has('flame') || params.has('cv')
}
