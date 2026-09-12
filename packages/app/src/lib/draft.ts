import { parseFlameEnvelope } from '@/utils/flameImport'
import { loadRecentFlame, recentFlameFingerprint, upsertRecentFlame, } from '@/utils/recentFlames'
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/utils/storage'
import { onAppPause } from './lifecycle'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { ParsedFlame } from '@/utils/flameImport'
import type { RecentFlameClaim } from '@/utils/recentFlames'
import type { TimelineConfig, TimelineTrack } from '@/utils/timeline'

/**
 * The flame the app was holding when it went to the background.
 *
 * The editor's own autosave (hooks/useWorkspaceAutosave.ts) reaches Recents
 * on pagehide and at every load boundary - but a WebView the OS force-stops
 * never fires pagehide, and both platforms force-stop without warning. Pause
 * is the last moment a native app is told about, so the flame goes here too,
 * and the next cold start puts it in Recents and offers it back.
 *
 * The stored value is the envelope `utils/flameImport` already reads, so a
 * draft is validated on the way back in exactly like an imported file: a
 * flame written by an older build that no longer validates is dropped rather
 * than loaded half-formed.
 *
 * ONE RULE GOVERNS THIS MODULE: a draft is never deleted because the
 * workspace looks clean. It goes when its content is in Recents, and it is
 * replaced when there is newer unsaved work to replace it with - nothing
 * else. Three fix passes deleted work here by comparing the workspace
 * against a baseline and clearing the slot when the two matched, and each
 * was undone by another path that re-took the baseline first. There is no
 * baseline in this module now: nothing to re-take, no call site to guard,
 * and the worst this can do is offer a stale draft once.
 */
export const DRAFT_KEY = 'chaos-master-draft'

/**
 * Everything a draft is made of, in one shape.
 *
 * The workspace used to write the flame and the tracks out by hand and the
 * config to neither, so a restored animation came back at the hand-off's
 * reset - 30fps over 90 frames - and a change to only the fps or the end
 * frame read as no change at all.
 */
export interface DraftState {
  readonly flame: FlameDescriptor
  readonly tracks: readonly TimelineTrack[]
  readonly config: TimelineConfig
  /**
   * The Recents entry this editing session keeps updating
   * (hooks/useWorkspaceAutosave.ts). It rides along so the launch that
   * rescues the draft writes into the entry the killed session owned, rather
   * than adding a second one beside it. It is spent there: the workspace the
   * draft is restored into opens an entry of its own (see RestoredDraft).
   */
  readonly sessionId: string
}

interface DraftEnvelope {
  readonly flame: FlameDescriptor
  readonly savedAt: number
  readonly animation: {
    readonly tracks: readonly TimelineTrack[]
    readonly config: TimelineConfig
  }
  readonly sessionId: string
}

const envelopeOf = (state: DraftState): DraftEnvelope => ({
  flame: state.flame,
  savedAt: Date.now(),
  // The share link's shape, so one envelope reader serves both: the config
  // is what says how long the animation is and how fast it runs. Written
  // whether or not there are tracks, because a flame with none still has a
  // timeline. The reader drops an empty track list and reads the config
  // beside it (utils/flameImport).
  animation: { tracks: state.tracks, config: state.config },
  sessionId: state.sessionId,
})

/** Everything but the clock: what says whether a pause has anything new. */
const contentOf = (envelope: {
  flame?: unknown
  animation?: unknown
  sessionId?: unknown
}): string =>
  JSON.stringify({
    flame: envelope.flame,
    animation: envelope.animation,
    sessionId: envelope.sessionId,
  })

/** The stored envelope as it was written, or nothing at all. */
function storedEnvelope(): Record<string, unknown> | undefined {
  const raw = safeGetItem(DRAFT_KEY)
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return undefined
    }
    return parsed as Record<string, unknown>
  } catch {
    // A half-written value (the OS killed the app mid-write) is not an error
    // worth showing: there is simply no draft.
    return undefined
  }
}

/**
 * Record the workspace, if it is holding anything Recents does not have.
 *
 * `unsaved` is the editor's own dirty flag, the app's one authority on that
 * question - this module keeps no second opinion of its own. It can only
 * suppress a write: a clean workspace leaves whatever is stored exactly
 * where it is, because "clean" has been wrong about restored work three
 * times and the price of being wrong has to be a stale draft rather than a
 * deleted one.
 */
export function saveDraft(state: DraftState, unsaved: boolean): void {
  if (!unsaved) return
  const envelope = envelopeOf(state)
  const stored = storedEnvelope()
  // Android fires pause for every share sheet and permission dialog, so the
  // same second of work would otherwise be rewritten a dozen times over.
  if (stored !== undefined && contentOf(stored) === contentOf(envelope)) return
  if (!safeSetItem(DRAFT_KEY, JSON.stringify(envelope))) {
    // The safety net is gone and there is nobody to tell at pause time, so
    // at least leave the reason somewhere rather than failing silently.
    console.warn(
      '[draft] storage refused the draft; this session is not backed up',
    )
  }
}

export interface DraftBackup {
  readonly dispose: () => void
}

/**
 * The background safety net, wired to one reader.
 *
 * Native only: on the web pause is `visibilitychange`, which fires on every
 * tab switch, and only the native build ever reads a draft back.
 */
export function installDraftBackup(input: {
  native: boolean
  read: () => DraftState
  /** Whether the workspace holds work that Recents does not have. */
  unsaved: () => boolean
}): DraftBackup {
  if (!input.native) {
    return { dispose: () => undefined }
  }
  return {
    dispose: onAppPause(() => {
      saveDraft(input.read(), input.unsaved())
    }),
  }
}

export function readDraft(): ParsedFlame | undefined {
  const stored = storedEnvelope()
  if (stored === undefined) return undefined
  return parseFlameEnvelope(stored)
}

export function clearDraft(): void {
  safeRemoveItem(DRAFT_KEY)
}

/**
 * Empty the slot when what is in it is the work that was just saved.
 *
 * The other way the slot is spent. `takeDraftForLaunch` clears it once the
 * rescue has put the work in Recents, but at the cap the rescue writes
 * nothing and keeps it - so the next launch offered the same flame again,
 * with a notice telling the user to save it for later, and nothing that save
 * did could stop the notice coming back on the launch after that. Their own
 * save ends it.
 *
 * The comparison is the whole safety of this: the slot may be holding one
 * piece of work while the workspace holds another - a restored draft, then a
 * different flame opened from Library - and emptying it on any successful
 * save would delete work that has never been anywhere else. Same flame, same
 * animation, same timeline, or the slot stays exactly where it is.
 */
export function clearDraftIfSaved(state: {
  flame: FlameDescriptor
  tracks: readonly TimelineTrack[]
  config: TimelineConfig
}): void {
  const stored = storedEnvelope()
  if (stored === undefined) return
  const saved = {
    flame: state.flame,
    animation: { tracks: state.tracks, config: state.config },
    sessionId: stored.sessionId,
  }
  if (contentOf(stored) === contentOf(saved)) clearDraft()
}

/**
 * A draft the launch has adopted. Its work is already in Recents by the time
 * a caller holds one of these.
 */
export interface RestoredDraft {
  readonly flame: FlameDescriptor
  readonly tracks?: TimelineTrack[]
  readonly config?: TimelineConfig
  /**
   * The entry the rescue wrote, with a fingerprint of exactly what it wrote
   * there, for the workspace to carry on in rather than opening a second
   * entry for the same work (hooks/useWorkspaceAutosave.ts).
   *
   * A bare id is never enough. Handing one over made the workspace's autosave
   * the owner of an entry it had not written: the rescue skips its write when
   * what is already at that id is newer, and the first autosave after the
   * restore then put the older restored flame over the newer entry, having
   * told the user their work was restored. So this is present only when the
   * rescue actually wrote, it carries what was written, and the workspace
   * checks that the entry still holds it before touching anything.
   */
  readonly entry?: RecentFlameClaim
  /**
   * Why the work is in the workspace only, when it is: Recents is at its cap
   * and taking it would evict a flame the user kept, or the write was
   * refused. The draft slot keeps the work in both cases, so the launch
   * after this one offers it again - but the notice must not say the flame
   * is somewhere it is not.
   */
  readonly unsecured?: UnsecuredReason
}

/** What stopped the rescue writing: a full shelf, or storage saying no. */
export type UnsecuredReason = 'full' | 'refused'

/** A session id for a draft written before the envelope carried one. */
const strandedSessionId = (): string =>
  `autosave-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/**
 * Put a draft's work in Recents, in the entry the session that wrote it
 * owned.
 *
 * Secured means one thing: the work is on the shelf the user can reach, and
 * the Library will show it. So the comparison reads the entry through
 * `loadRecentFlame`, which validates it exactly as the Library does - the
 * structural loader accepts an entry whose flame is an empty object, which
 * would have counted as a copy of the work while being invisible everywhere
 * the user could look for it - and the write is trusted only when the writer
 * says it read back. One entry, not the list: this runs before first paint on
 * every native cold start that has a draft, and a schema pass over a full
 * shelf costs about 90ms.
 *
 * @returns why the work is not there, or nothing when it is - and the draft
 * slot is then still the only copy of it - plus whether this call is what put
 * it there. `wrote` is what decides whether the workspace may carry on in
 * that entry: when the entry already held newer work of the same session
 * this writes nothing, and handing it over then would let the first autosave
 * put the older restored flame over the newer half. That is the overwrite
 * this module exists to prevent, so a skipped write hands over nothing and
 * the launch costs a duplicate entry instead.
 */
function secureInRecents(
  draft: ParsedFlame,
  sessionId: string,
): { unsecured?: UnsecuredReason; wrote: boolean } {
  const existing = loadRecentFlame(sessionId)
  // That session's autosave writes to this entry too. A draft written before
  // the last autosave holds the older half of one piece of work, and
  // overwriting the newer half with it would be the loss this module exists
  // to prevent.
  //
  // A draft with no usable clock is the newest thing there is. Reading it as
  // the oldest handed the argument to any entry that existed, and the slot
  // was then cleared without the work ever being written anywhere: the one
  // default this module cannot take is the one that deletes.
  const writtenAt = draft.savedAt ?? Number.POSITIVE_INFINITY
  if (existing && existing.savedAt >= writtenAt) return { wrote: false }
  // The timeline goes in with the tracks. Without it the rescued entry came
  // back at the workspace's defaults once the slot was cleared, so the frame
  // rate the work was authored at lived only in memory.
  //
  // At the cap the writer declines rather than pushing the oldest entry out:
  // that entry is a flame the user chose to keep and this one is debris from
  // a crash, and Save for Later stops and asks before the same eviction. The
  // guard lives in the writer, so every path is held to it and not just this
  // one (utils/recentFlames.ts).
  const outcome = upsertRecentFlame(
    sessionId,
    draft.flame,
    undefined,
    draft.tracks,
    draft.config,
  )
  // `saved` already means the entry reads back the way the Library reads it,
  // its timeline included - the writer confirms its own write, so every path
  // through it gets the same answer and this one does not read the list a
  // second time (utils/recentFlames.ts). A write that lands as something the
  // Library drops is not a rescue, and saying so is what lets the slot keep
  // the only copy.
  if (outcome !== 'saved') return { unsecured: outcome, wrote: false }
  return { wrote: true }
}

/**
 * What a launch does with the draft: rescue it, then hand it back.
 *
 * Native only: nothing writes a draft on the web, where a tab is not
 * force-stopped from under the user.
 *
 * The work reaches Recents first, so from that moment it is safe whatever
 * the user does next - taps a starter flame on the welcome grid, opens
 * something from Library, follows a friend's link. Nothing downstream has to
 * remember to flush it before dropping it, which is what every earlier
 * version of this got wrong.
 *
 * Two things can stop it getting there: a full shelf, where taking a place
 * would evict a flame the user kept, and storage refusing the write. Neither
 * is worth destroying something for, so the draft stays in its slot, the
 * flame is still handed to the workspace, and the caller is told not to
 * promise it is saved.
 *
 * The welcome screen is deliberately not an input. It is not a first run: it
 * shows on every launch until the user ticks "Don't show again", and the
 * workspace is mounted behind it, so a restored flame is waiting once they
 * enter. A link that carries its own flame is an input: restoring over it
 * would replace what the link was opened for, so the draft is left where it
 * is - declined, not deleted - and the next plain launch offers it again.
 */
export function takeDraftForLaunch(input: {
  native: boolean
  search: string
}): RestoredDraft | undefined {
  if (!input.native) return undefined
  const stored = storedEnvelope()
  if (stored === undefined) return undefined
  const parsed = parseFlameEnvelope(stored)
  if (parsed === undefined) return undefined

  const sessionId =
    typeof stored.sessionId === 'string' && stored.sessionId !== ''
      ? stored.sessionId
      : strandedSessionId()
  const { unsecured, wrote } = secureInRecents(parsed, sessionId)

  if (hasSharePayload(input.search)) return undefined
  // Only once the work is somewhere else. If Recents could not take it the
  // slot is all there is, so the draft stays in it and the caller is told,
  // because the flame is then only as safe as this one process.
  if (unsecured === undefined) clearDraft()
  // What was written, so the workspace can carry on in that entry rather
  // than opening a second one for the same work. Taken from storage after
  // the write, so it is the stored shape both sides compare - and only when
  // this launch is what wrote it.
  const fingerprint = wrote ? recentFlameFingerprint(sessionId) : undefined
  return {
    flame: parsed.flame,
    ...(parsed.tracks ? { tracks: parsed.tracks } : {}),
    ...(parsed.config ? { config: parsed.config } : {}),
    ...(unsecured ? { unsecured } : {}),
    ...(fingerprint === undefined
      ? {}
      : { entry: { id: sessionId, fingerprint } }),
  }
}

/**
 * A link that carries its own flame (`?s=`, `?flame=`) or variation (`?cv=`).
 * Restoring the draft over it would replace what the link was opened for.
 */
export function hasSharePayload(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.has('s') || params.has('flame') || params.has('cv')
}
