import { onCleanup } from 'solid-js'
import { autosaveIntervalMin, autosaveRecents, saveReminderDismissed, setAutosaveRecents, setSaveReminderDismissed, } from '@/utils/autosaveSettings'
import { MAX_RECENT_FLAMES, recentFlameFingerprint, upsertRecentFlame, } from '@/utils/recentFlames'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { FlushOutcome } from '@/lib/documentLoad'
import type { RecentFlameClaim, RecentWriteOutcome } from '@/utils/recentFlames'
import type { TimelineConfig, TimelineTrack } from '@/utils/timeline'

export interface UseWorkspaceAutosaveParams {
  flameDescriptor: FlameDescriptor
  getTracks: () => TimelineTrack[] | undefined
  /**
   * The timeline the flame is being edited at. Part of the document, not of
   * the tracks: the frame rate, the speed, the end frame and the loop mode
   * live in their own signal, so a snapshot of the flame and its keyframes
   * alone reported a workspace with a changed frame rate as holding nothing
   * unsaved - no draft on pause, no flush at a load boundary, and the change
   * died with the process.
   */
  getConfig: () => TimelineConfig | undefined
  agentDriving: () => boolean
  showToast: (
    message: string,
    duration?: number | 'sticky',
    actions?: Array<{ label: string; onClick: () => void }>,
  ) => void
  /**
   * Put "Recents is full - may this replace the oldest flame?" to the user
   * and resolve with their answer.
   *
   * Taken as a parameter rather than reached for, because only one caller
   * here is ever allowed to ask: the flush at a document replacement, which
   * is the last moment the open document's work exists anywhere. The
   * interval autosave and the pagehide flush both have answers of their own
   * (below) and neither may raise this.
   */
  confirmOverwriteOldest: () => Promise<boolean>
}

export function useWorkspaceAutosave(params: UseWorkspaceAutosaveParams) {
  const {
    flameDescriptor,
    getTracks,
    getConfig,
    agentDriving,
    showToast,
    confirmOverwriteOldest,
  } = params

  const newAutosaveId = () =>
    `autosave-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  /**
   * The entry this session owns. Always a fresh one, except for the single
   * case below: the rescue skips its write when what is already at an id is
   * newer, and a workspace that had adopted that id put the older restored
   * flame over the newer entry at its first autosave. An id alone is not
   * evidence of anything (lib/draft.ts).
   */
  let autosaveSessionId = newAutosaveId()
  /**
   * The entry a launch rescued this document's work into, and a fingerprint
   * of exactly what the rescue wrote there.
   *
   * Taking it over is what keeps one restored flame in one entry: without it
   * the rescue wrote one entry and this session wrote another for the same
   * work, so every crash cost two of the 150 places. It is taken over only
   * while the entry still holds that exact content, checked at the moment of
   * the write rather than at the hand-off - so an entry something else has
   * written to since is left alone, and the id is never trusted on its own.
   */
  let restoredEntry: RecentFlameClaim | undefined
  /** Said once. A full shelf does not empty itself mid-session. */
  let fullNoticeShown = false
  const autosaveSnapshot = () =>
    JSON.stringify({
      flame: flameDescriptor,
      tracks: getTracks(),
      config: getConfig(),
    })
  /** Which document the current entry belongs to - see markLoadedBaseline. */
  let sessionFlame = JSON.stringify(flameDescriptor)
  let autosaveBaseline = autosaveSnapshot()
  let editingSince: number | null = null
  let lastAutosaveAt = 0
  let reminderShown = false
  let autosavePromptShown = false

  const isFlameDirty = () => autosaveSnapshot() !== autosaveBaseline
  const markSavedBaseline = () => {
    autosaveBaseline = autosaveSnapshot()
  }
  const markLoadedBaseline = () => {
    autosaveBaseline = autosaveSnapshot()
    editingSince = null
    // A load boundary starts a new Recents entry only when it actually loads
    // a different document. One hand-off crosses this boundary twice - the
    // flame lands in one effect and its animation in another - so keying the
    // new entry on the call rather than on the flame gave the second half of
    // a restored draft an entry of its own, beside the one the launch had
    // just put the same work into (lib/draft.ts).
    const flame = JSON.stringify(flameDescriptor)
    if (flame !== sessionFlame) {
      sessionFlame = flame
      autosaveSessionId = newAutosaveId()
      // A different document cannot inherit a claim on the entry the one
      // before it was rescued into.
      restoredEntry = undefined
    }
  }

  /**
   * One write of the open document into this session's Recents entry.
   *
   * `force` is what gets a write past the guard that stops an automatic save
   * from deleting a flame the user kept (utils/recentFlames.ts), so it is
   * never a default and never a convenience: the two callers that pass true
   * both have a reason the guard was written for - a user who answered the
   * question, and a process that is about to end.
   */
  const writeToRecents = (force: boolean): RecentWriteOutcome => {
    const claim = restoredEntry
    if (claim) {
      // Checked here rather than where the entry was offered, because this is
      // the moment of the write: an entry something else has taken over since
      // the hand-off is left alone, and this session opens one of its own.
      // One shot, whichever way it goes.
      restoredEntry = undefined
      if (recentFlameFingerprint(claim.id) !== claim.fingerprint) {
        autosaveSessionId = newAutosaveId()
      }
    }
    const outcome = upsertRecentFlame(
      autosaveSessionId,
      flameDescriptor,
      undefined,
      getTracks(),
      getConfig(),
      force,
    )
    if (outcome === 'saved') {
      lastAutosaveAt = Date.now()
      markSavedBaseline()
    }
    return outcome
  }

  /** Declining is right - the alternative is deleting a flame the user kept -
   *  but declining in silence is the app quietly not saving. Said once: a
   *  full shelf does not empty itself mid-session. */
  const noticeFull = () => {
    if (fullNoticeShown) return
    fullNoticeShown = true
    // Long enough to read and act on. Asking for 'sticky' would have been
    // quietly downgraded to the four-second default, because a sticky toast
    // with nothing to answer it with cannot be dismissed and the toast store
    // refuses to strand one (contexts/ToastContext).
    showToast(
      `Recents is full (${MAX_RECENT_FLAMES} flames), so this one was not auto-saved. Delete one in Library, or use Save for Later to replace the oldest.`,
      12000,
    )
  }

  const autosaveNow = () => {
    if (writeToRecents(false) === 'full') noticeFull()
  }

  /**
   * Save the open document if it holds anything unsaved, and say what
   * happened. Callers act on the answer differently, which is why this
   * reports one instead of swallowing it: a document replacement stops on
   * `full` and asks, pagehide forces past it, and the interval autosave
   * raises the notice (lib/documentLoad.ts).
   */
  const flushDirtyToRecents = (force = false): FlushOutcome => {
    if (!isFlameDirty()) return 'clean'
    return writeToRecents(force)
  }

  /**
   * Settle the one question a document replacement cannot answer for itself,
   * before any of the replacement happens.
   *
   * At the cap the two things that could give way are both the user's: the
   * flame they are looking at, unsaved, or the oldest one they kept. The app
   * picking silently is how a tap on Library came to destroy the open
   * document's keyframe tracks - undo brings a flame back, not its tracks -
   * so it asks, with the same modal Save for Later asks with.
   *
   * @returns whether the replacement may go ahead. False is the user's own
   * no, and then nothing is loaded and their work stays on screen.
   */
  const prepareDocumentReplacement = async (): Promise<boolean> => {
    if (flushDirtyToRecents() !== 'full') return true
    if (!(await confirmOverwriteOldest())) {
      // A tap that appears to do nothing is the one outcome a user cannot
      // report, so name what their answer did.
      showToast('Kept the open flame. Nothing was loaded.', 5000)
      return false
    }
    if (flushDirtyToRecents(true) !== 'saved') {
      // They said yes and it still did not land, which is storage refusing
      // rather than the shelf being full - nothing left to ask. Going ahead
      // anyway, because a workspace that cannot write to storage must not
      // become one that can never open a flame either.
      showToast('Could not save the open flame to Recents', 5000)
    }
    return true
  }

  const saveOnPagehide = () => {
    // The only automatic path allowed to evict a kept flame, because it is
    // the only one with nobody to ask and no next chance: the process is
    // going away, and losing the oldest entry on the shelf is the smaller
    // loss against certainly losing the document that is open.
    if (flushDirtyToRecents() === 'full') flushDirtyToRecents(true)
    // The one-per-run notice is deliberately not spent here. A toast raised
    // as the page is being torn down is never on screen long enough to read,
    // and spending the flag on it would silence the notice for the rest of
    // the run - so the user would never learn the shelf is full.
  }
  window.addEventListener('pagehide', saveOnPagehide)
  onCleanup(() => {
    window.removeEventListener('pagehide', saveOnPagehide)
  })

  const AUTOSAVE_POLL_MS = 30_000
  const REMINDER_AFTER_MS = 5 * 60_000
  const autosavePoll = setInterval(() => {
    const dirty = isFlameDirty()
    if (dirty && editingSince === null) editingSince = Date.now()

    if (
      dirty &&
      autosaveRecents() === 'unset' &&
      !autosavePromptShown &&
      !agentDriving()
    ) {
      autosavePromptShown = true
      showToast('Auto-save your flames to Recents while you edit?', 'sticky', [
        {
          label: 'Yes',
          onClick: () => {
            setAutosaveRecents('on')
            // The notice belongs to this write too: the user has just asked
            // for auto-saving, so a shelf too full to take it is theirs to
            // hear about - and this used to reach it through `autosaveNow`.
            if (flushDirtyToRecents() === 'full') noticeFull()
          },
        },
        { label: 'No', onClick: () => setAutosaveRecents('off') },
      ])
      return
    }

    if (dirty && autosaveRecents() === 'on') {
      const intervalMs = Math.max(1, autosaveIntervalMin()) * 60_000
      if (Date.now() - lastAutosaveAt >= intervalMs) autosaveNow()
    }

    if (
      !reminderShown &&
      !saveReminderDismissed() &&
      !agentDriving() &&
      editingSince !== null &&
      Date.now() - editingSince >= REMINDER_AFTER_MS
    ) {
      reminderShown = true
      showToast(
        'Enjoying this flame? Save it for later, export a PNG, or share a link from the actions bar.',
        12000,
        [
          {
            label: "Don't show again",
            onClick: () => setSaveReminderDismissed(true),
          },
        ],
      )
    }
  }, AUTOSAVE_POLL_MS)

  onCleanup(() => {
    clearInterval(autosavePoll)
  })

  return {
    isFlameDirty,
    markSavedBaseline,
    markLoadedBaseline,
    autosaveNow,
    flushDirtyToRecents,
    prepareDocumentReplacement,
    /**
     * Offer this session the entry a launch rescued its document into
     * (lib/draft.ts). Called after the hand-off's load boundary, because that
     * boundary is what mints the id this replaces.
     */
    claimRestoredEntry: (entry: RecentFlameClaim | undefined) => {
      restoredEntry = entry
      // Taken on immediately, not at the first write: the pause backup names
      // this entry in the draft it writes (lib/draft.ts), so a crash between
      // the restore and the first flush would otherwise send the next launch
      // to a fresh id and file the same work a second time. Nothing is
      // written here - the entry is still checked at the moment of the write,
      // and a fresh id minted then if it is no longer what the rescue left.
      if (entry) autosaveSessionId = entry.id
    },
    /** The Recents entry this session writes to, for the pause backup. */
    autosaveSessionId: () => autosaveSessionId,
  }
}
