import { onCleanup } from 'solid-js'
import { autosaveIntervalMin, autosaveRecents, saveReminderDismissed, setAutosaveRecents, setSaveReminderDismissed, } from '@/utils/autosaveSettings'
import { MAX_RECENT_FLAMES, recentFlameFingerprint, upsertRecentFlame, } from '@/utils/recentFlames'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { RecentFlameClaim } from '@/utils/recentFlames'
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
}

export function useWorkspaceAutosave(params: UseWorkspaceAutosaveParams) {
  const { flameDescriptor, getTracks, getConfig, agentDriving, showToast } =
    params

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

  const autosaveNow = () => {
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
    )
    if (outcome === 'full') {
      // Declining is right - the alternative is deleting a flame the user
      // kept - but declining in silence is the app quietly not saving. Say
      // it once, and say what clears it.
      if (!fullNoticeShown) {
        fullNoticeShown = true
        // Long enough to read and act on. Asking for 'sticky' would have
        // been quietly downgraded to the four-second default, because a
        // sticky toast with nothing to answer it with cannot be dismissed
        // and the toast store refuses to strand one (contexts/ToastContext).
        showToast(
          `Recents is full (${MAX_RECENT_FLAMES} flames), so this one was not auto-saved. Delete one in Library, or use Save for Later to replace the oldest.`,
          12000,
        )
      }
      return
    }
    if (outcome !== 'saved') return
    lastAutosaveAt = Date.now()
    markSavedBaseline()
  }

  const flushDirtyToRecents = () => {
    if (isFlameDirty()) autosaveNow()
  }

  const saveOnPagehide = () => {
    flushDirtyToRecents()
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
            flushDirtyToRecents()
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
