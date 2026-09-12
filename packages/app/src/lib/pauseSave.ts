import { parseFlameEnvelope } from '@/utils/flameImport'
import { newRecentFlameId, upsertRecentFlame } from '@/utils/recentFlames'
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/utils/storage'
import { onAppPause } from './lifecycle'
import type { FlushOutcome } from './documentLoad'

/**
 * The save the native app makes on its way to the background.
 *
 * The editor's own autosave reaches Recents on pagehide and at every load
 * boundary (hooks/useWorkspaceAutosave.ts) - but a WebView the OS force-stops
 * never fires pagehide, and both platforms force-stop without warning. Pause
 * is the last moment a native app is told about, so the open document is
 * written then too.
 *
 * It is written to RECENTS, through the same writer every other save uses.
 * There used to be a slot of its own here - one flame, under one key, rescued
 * into Recents by the next cold start and handed back to the workspace - and
 * the work then had to survive the rescue, the seeding, the welcome screen and
 * whatever the user opened next. Each of those steps lost it at least once.
 * Writing where every other write lands leaves no restore ceremony to get
 * wrong: the flame is on the shelf from the moment the app is backgrounded,
 * and the next launch is an ordinary launch.
 *
 * What the slot could do and Recents cannot is report a refusal. A toast
 * raised as the process ends is never read, so a pause that could not save
 * says so at the NEXT launch instead - see {@link takePauseSaveFailure}.
 */

/** The single-slot crash copy of a build before the fold. Read once on launch
 *  and retired - see {@link migrateLegacyDraft}. Nothing writes it any more. */
export const LEGACY_DRAFT_KEY = 'chaos-master-draft'

/** Set when a pause could not save, cleared when one does or when a launch
 *  has said so. A few bytes on purpose: the write that just failed was the
 *  whole flame list, and this can still land where a quota refused that. */
const PAUSE_FAILED_KEY = 'chaos-master-pause-save-failed'

/**
 * The open document's writer, as the workspace last installed it.
 *
 * One slot rather than a set: a workspace that mounts again replaces the one
 * before it, and two writers for one document would file the same work twice.
 */
let saveOpenDocument: (() => FlushOutcome) | undefined
/** Whether the pause subscription exists. Taken once and never given back. */
let subscribed = false

/** Carry a pause that did not save to the next launch, and take back a
 *  complaint the session has since made good. */
function recordOutcome(outcome: FlushOutcome): void {
  // Nothing to say: either the document was already on the shelf, or it is
  // there now.
  if (outcome === 'clean') return
  if (outcome === 'saved') {
    // An earlier pause in this session could not save and this one did, so
    // the work is on the shelf and a launch that still complained would be
    // crying wolf about work the user has.
    safeRemoveItem(PAUSE_FAILED_KEY)
    return
  }
  if (!safeSetItem(PAUSE_FAILED_KEY, '1')) {
    // Storage refusing the flame and then refusing three bytes is a device
    // with nothing left at all. There is nowhere to leave a message for the
    // user, so leave one where a developer can find it.
    console.warn(
      '[pause] the open flame was not saved, and saying so failed too',
    )
  }
}

/**
 * Wire the pause write to the open document.
 *
 * There is no disposer, and that is the point. The workspace installs this
 * from its component body, and an ErrorBoundary catch (App.tsx) or a WebGPU
 * degrade unmounts the workspace - an `onCleanup` here would take the crash
 * net down with the editor and leave the process saving nothing, at exactly
 * the moment there is unsaved work and no editor left to write it. The reader
 * keeps working after its owner is disposed: it reads an unwrapped store and
 * plain signals, and disposing an owner empties neither.
 *
 * Native only. On the web pause is `visibilitychange`, which fires on every
 * tab switch, and a tab gets its pagehide - it is not force-stopped from under
 * the user.
 */
export function installPauseSave(input: {
  native: boolean
  /** Save the open document if it holds anything unsaved, and say what
   *  happened (hooks/useWorkspaceAutosave.ts). */
  save: () => FlushOutcome
}): void {
  if (!input.native) return
  saveOpenDocument = input.save
  if (subscribed) return
  subscribed = true
  onAppPause(() => {
    const save = saveOpenDocument
    if (save) recordOutcome(save())
  })
}

/** Test seam: forget the installed writer, so one test's workspace cannot
 *  write on the next test's pause. Nothing in the app calls this - the
 *  subscription is meant to outlive every unmount. */
export function stopPauseSave(): void {
  saveOpenDocument = undefined
}

/**
 * Whether the last pause could not save the open document.
 *
 * Said once: reading it clears the flag. The alternative to carrying it here
 * is a toast at pause time, which is raised as the process is being torn down
 * and never reaches a reader - and a save that silently did not happen is the
 * one outcome a user cannot find out about any other way.
 */
export function takePauseSaveFailure(): boolean {
  if (safeGetItem(PAUSE_FAILED_KEY) === null) return false
  safeRemoveItem(PAUSE_FAILED_KEY)
  return true
}

/**
 * Move a pre-fold crash copy onto the shelf, once.
 *
 * An upgrade must not cost the work the old build was holding: it wrote the
 * flame it had open into a slot of its own, and after the fold nothing reads
 * that slot. So the launch puts it in Recents, where the Library shows it, and
 * only then forgets the key.
 *
 * ORDER IS THE WHOLE OF IT: the key goes only after a write that landed. At
 * the cap, and when storage refuses, the slot is still the only copy of that
 * work, so it stays exactly where it is and the next launch tries again - the
 * user freeing one place in Library is what finishes the migration.
 *
 * A fresh id, never the session id the envelope carries. That id may name an
 * entry the old build's autosave wrote AFTER this copy - the two are halves of
 * one session's work - and writing this over it would destroy the newer half.
 * The cost of a fresh id is one duplicate entry on the launch after an
 * upgrade, which the user can delete; the cost of reusing the id is work that
 * cannot be got back.
 *
 * Not gated on the platform. Only a native build ever wrote the key, so on the
 * web this is one lookup that finds nothing - cheaper than a flag that has to
 * stay right.
 */
export function migrateLegacyDraft(): void {
  const raw = safeGetItem(LEGACY_DRAFT_KEY)
  if (raw === null) return
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  } catch {
    // A half-written value: the OS killed the old build in the middle of the
    // write. There is nothing in it to move, and it is left alone rather than
    // deleted - deleting what has not been written somewhere else is the one
    // thing this module never does, and utils/storageUsage.ts keeps the key
    // out of "Clear settings" for the same reason.
    return
  }
  // The same reader an imported file goes through, so a flame written by a
  // build that no longer validates is dropped rather than moved in
  // half-formed.
  const draft = parseFlameEnvelope(stored)
  if (draft === undefined) return
  const outcome = upsertRecentFlame(
    newRecentFlameId(),
    draft.flame,
    undefined,
    draft.tracks,
    draft.config,
  )
  if (outcome === 'saved') safeRemoveItem(LEGACY_DRAFT_KEY)
}
