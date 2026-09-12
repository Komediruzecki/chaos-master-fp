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
  /**
   * @returns the toast's id, or -1 when nothing was shown - the store is
   * muted while an Arcade pilot drives (contexts/ToastContext.tsx). The
   * answer is load-bearing here: the notices below are said once per run, and
   * spending that one shot on a toast nobody saw would silence it for the
   * rest of the session.
   */
  showToast: (
    message: string,
    duration?: number | 'sticky',
    actions?: Array<{ label: string; onClick: () => void }>,
  ) => number
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
  /**
   * Put "storage refused to save the open flame - open the other one
   * anyway?" to the user and resolve with their answer.
   *
   * A different question from the one above, and so a different prompt: at
   * the cap something of the user's gives way whichever answer they give and
   * they choose which, while a refusal offers nothing to trade - the work
   * cannot be stored at all, and the only thing left to decide is whether to
   * walk away from it. Answering no keeps it, so no is the default.
   */
  confirmDiscardUnsaved: () => Promise<boolean>
}

export function useWorkspaceAutosave(params: UseWorkspaceAutosaveParams) {
  const {
    flameDescriptor,
    getTracks,
    getConfig,
    agentDriving,
    showToast,
    confirmOverwriteOldest,
    confirmDiscardUnsaved,
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
  /** Said once each. Neither a full shelf nor a storage that says no fixes
   *  itself mid-session, and both are spent only on a toast that was shown. */
  let fullNoticeShown = false
  let refusedNoticeShown = false
  /**
   * Set while the open document exists in this process and nowhere else: a
   * draft the launch put back in front of the user but could NOT put in
   * Recents, because the shelf is at its cap or storage refused the write
   * (lib/draft.ts).
   *
   * It forces the dirty flag, and that is the whole of it. Baselining such a
   * restore marks the only live copy of a user's flame clean, and the
   * interval autosave, the pagehide flush and the flush at the next
   * replacement all skip a clean document - so the single draft slot was the
   * only copy left, and the next pause on a different document took it. The
   * flame and its whole animation went, after the app had said it was
   * restored.
   */
  let unsecuredRestore = false
  const autosaveSnapshot = () =>
    JSON.stringify({
      flame: flameDescriptor,
      tracks: getTracks(),
      config: getConfig(),
    })
  /** Which document the unspent rescue claim belongs to - see
   *  markLoadedBaseline. */
  let sessionFlame = JSON.stringify(flameDescriptor)
  let autosaveBaseline = autosaveSnapshot()
  /**
   * The document as the last load boundary left it: what says whether the
   * USER has touched this document, as against whether Recents is holding a
   * copy of it.
   *
   * The two are the same question on every ordinary load and not the same
   * question on an unsecured restore, which is dirty from the moment it opens
   * and by nobody's doing. "Auto-save your flames?" and "Enjoying this
   * flame?" fired on a launch nobody had touched when that was keyed on dirty
   * alone.
   */
  let untouchedSnapshot = autosaveBaseline
  let editingSince: number | null = null
  let lastAutosaveAt = 0
  let reminderShown = false
  let autosavePromptShown = false

  const isFlameDirty = () =>
    unsecuredRestore || autosaveSnapshot() !== autosaveBaseline
  /** Whether the user has changed anything since the document opened. */
  const isUserEdited = () => autosaveSnapshot() !== untouchedSnapshot
  const markSavedBaseline = () => {
    autosaveBaseline = autosaveSnapshot()
    // The work is on the shelf now, so nothing is holding the only copy of it
    // any more.
    unsecuredRestore = false
  }
  /**
   * A different document is on screen: re-take the baseline, and start a
   * Recents entry of its own for it.
   *
   * `unsecured` is the one load whose work is NOT in Recents - a restored
   * draft the rescue could not shelve (lib/draft.ts). It is left dirty so
   * every writer still catches it; only the prompts are told nobody has
   * touched it.
   *
   * A boundary ALWAYS starts a new entry. It used to start one only when the
   * incoming flame differed from the last one, which quietly kept the entry
   * across "open F, edit, open F again from Library": the flush wrote the
   * edits into that entry, the boundary kept it, and the next autosave of the
   * fresh copy replaced them - under the same name, so nothing looked wrong.
   *
   * What the comparison was really holding together is a single hand-off,
   * which crosses this boundary twice: the flame lands in one effect and its
   * animation in another, and both halves carry the same flame, so the
   * descriptor cannot tell the second half of one load from a second load of
   * the same flame. What can is that nothing has been written in between -
   * the rescue's claim on the entry is still unspent (`claimRestoredEntry`,
   * spent at the first write). So the entry is kept for exactly that: an
   * unspent claim, on the flame it was taken for. Everything else rotates.
   */
  const markLoadedBaseline = (loaded: { unsecured?: boolean } = {}) => {
    const flame = JSON.stringify(flameDescriptor)
    if (loaded.unsecured) unsecuredRestore = true
    else if (flame !== sessionFlame) {
      // A different document is not the restore that could not be shelved.
      unsecuredRestore = false
    }
    if (!unsecuredRestore) autosaveBaseline = autosaveSnapshot()
    untouchedSnapshot = autosaveSnapshot()
    editingSince = null
    const continuesHandoff =
      restoredEntry !== undefined && flame === sessionFlame
    sessionFlame = flame
    if (continuesHandoff) return
    autosaveSessionId = newAutosaveId()
    // A different document cannot inherit a claim on the entry the one
    // before it was rescued into.
    restoredEntry = undefined
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
    // Long enough to read and act on. Asking for 'sticky' would have been
    // quietly downgraded to the four-second default, because a sticky toast
    // with nothing to answer it with cannot be dismissed and the toast store
    // refuses to strand one (contexts/ToastContext).
    const shown = showToast(
      `Recents is full (${MAX_RECENT_FLAMES} flames), so this one was not auto-saved. Delete one in Library, or use Save for Later to replace the oldest.`,
      12000,
    )
    // Spent only on a toast that reached the screen. The store is muted while
    // an Arcade pilot drives and returns -1 having shown nothing, so setting
    // the flag first meant the one notice a run gets could be swallowed by a
    // lesson and never said again (contexts/ToastContext.tsx).
    if (shown !== -1) fullNoticeShown = true
  }

  /**
   * Storage said no: a quota, a private window, a locked-down WebView.
   *
   * Nothing the user can rearrange fixes this, so unlike the full shelf there
   * is no action to point at - but the one thing they must not be left
   * believing is that auto-saving is running. It is not, and every write this
   * session makes is being discarded.
   */
  const noticeRefused = () => {
    if (refusedNoticeShown) return
    const shown = showToast(
      'Auto-saving is not working: this device refused to store the flame. Export a PNG or share a link to keep this one.',
      12000,
    )
    if (shown !== -1) refusedNoticeShown = true
  }

  /** Say what a write that did not land actually was. A refusal read as
   *  success for as long as only `full` was worth mentioning, so a user could
   *  edit for hours with every write discarded and nothing said. */
  const noticeOutcome = (outcome: FlushOutcome | RecentWriteOutcome) => {
    if (outcome === 'full') noticeFull()
    else if (outcome === 'refused') noticeRefused()
  }

  const autosaveNow = () => {
    noticeOutcome(writeToRecents(false))
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
   * The user has been asked and has chosen to open the other flame anyway.
   *
   * Nothing is written. What changes is that the work stops counting as
   * unsaved, so the chokepoint's own flush does not refuse the replacement a
   * second time over the answer that was just given (lib/documentLoad.ts).
   * The draft slot is untouched: on native it may still be holding this work,
   * and the worst that costs is one stale offer on the next launch, against
   * deleting something nobody asked to delete (lib/draft.ts).
   */
  const dropUnsavedWork = () => {
    autosaveBaseline = autosaveSnapshot()
    unsecuredRestore = false
  }

  /**
   * Settle the questions a document replacement cannot answer for itself,
   * before any of the replacement happens.
   *
   * At the cap the two things that could give way are both the user's: the
   * flame they are looking at, unsaved, or the oldest one they kept. The app
   * picking silently is how a tap on Library came to destroy the open
   * document's keyframe tracks - undo brings a flame back, not its tracks -
   * so it asks, with the same modal Save for Later asks with.
   *
   * A refusal is the other way the flush writes nothing, and it read as
   * success here for as long as only `full` was tested for: the replacement
   * went ahead and took the outgoing flame and its tracks with it, with
   * nothing said at all. There is nothing to trade in that case, so the
   * question is a different one and gets its own prompt - and the answer that
   * keeps their work is the default.
   *
   * @returns whether the replacement may go ahead. False is the user's own
   * no, and then nothing is loaded and their work stays on screen.
   */
  const prepareDocumentReplacement = async (): Promise<boolean> => {
    const kept = () => {
      // A tap that appears to do nothing is the one outcome a user cannot
      // report, so name what their answer did.
      showToast('Kept the open flame. Nothing was loaded.', 5000)
      return false
    }
    const outcome = flushDirtyToRecents()
    if (outcome === 'clean' || outcome === 'saved') return true
    if (outcome === 'full') {
      if (!(await confirmOverwriteOldest())) return kept()
      if (flushDirtyToRecents(true) === 'saved') return true
      // They said yes and it still did not land, which is storage refusing
      // rather than the shelf being full. Falling through to the refusal
      // question rather than going ahead: the eviction they agreed to bought
      // nothing, and the work on screen is still the only copy there is.
    }
    if (!(await confirmDiscardUnsaved())) return kept()
    dropUnsavedWork()
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
    // Both prompts are about the user's own editing, so they read the one
    // flag that means that. A restore the launch could not shelve is dirty
    // for the writers and untouched for these two, and asking "enjoying this
    // flame?" about a launch nobody has opened yet is how the dirty flag was
    // made to speak for something it does not know.
    const touched = dirty && isUserEdited()
    if (touched && editingSince === null) editingSince = Date.now()

    if (
      touched &&
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
            // for auto-saving, so a write that did not land is theirs to hear
            // about - and this used to reach it through `autosaveNow`. A
            // refusal especially: answering yes and seeing no complaint is
            // how a session came to edit for hours with every write discarded.
            noticeOutcome(flushDirtyToRecents())
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
      const shown = showToast(
        'Enjoying this flame? Save it for later, export a PNG, or share a link from the actions bar.',
        12000,
        [
          {
            label: "Don't show again",
            onClick: () => setSaveReminderDismissed(true),
          },
        ],
      )
      // Same as the notices above: a muted store shows nothing and returns
      // -1, and this is the only reminder the run gets.
      if (shown !== -1) reminderShown = true
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
