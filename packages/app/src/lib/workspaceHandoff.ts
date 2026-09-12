import { batch, createSignal } from 'solid-js'
import type { UnsecuredReason } from './draft'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { RecentFlameClaim } from '@/utils/recentFlames'
import type { TimelineConfig, TimelineTrack } from '@/utils/timeline'

/**
 * A flame on its way into the workspace, and everything that travels with
 * it.
 */
export interface WorkspaceSeed {
  readonly flame: FlameDescriptor
  readonly tracks?: TimelineTrack[]
  /** The timeline the flame's animation was authored at, if it has one. */
  readonly config?: TimelineConfig
  /** A Home "Explore" card's curated capability. */
  readonly capability?: string
  /**
   * The Recents entry a launch rescued this flame into, for the workspace to
   * carry on in rather than opening a second entry for the same work
   * (lib/draft.ts). Only a restored draft has one.
   */
  readonly restoredEntry?: RecentFlameClaim
  /**
   * Why a restored draft is NOT in Recents: the shelf was at its cap, or
   * storage refused the write (lib/draft.ts). The workspace has to know,
   * because such a restore is the only live copy of that flame - baselining
   * it as loaded marks it clean, and every writer skips a clean document
   * (hooks/useWorkspaceAutosave.ts).
   */
  readonly restoreUnsecured?: UnsecuredReason
  /**
   * Whether this seeding is the launch putting a rescued draft back. It gets
   * right of way over anything seeded after it until the workspace has taken
   * it - see `seed`.
   */
  readonly restored?: true
  /** Whether this also means "take me to the editor". */
  readonly enterWorkspace?: boolean
}

/**
 * The one-shot hand-off between whoever picked a flame and the workspace
 * that opens it: App.tsx owns one of these and MainWorkspace drains it.
 *
 * Every field is written on every seeding that lands, including the ones the
 * caller has nothing to say about. A path that set only some of them left the
 * rest standing from whoever seeded last, and the welcome grid is live before
 * the workspace chunk has finished loading - so a starter flame tapped in
 * that window arrived carrying the restored draft's timeline, and the entry
 * that draft had just been rescued into. One writer, every field, one batch.
 *
 * The same window is why a seeding can be refused: writing every field also
 * means a later tap wipes a restore that has not reached the editor yet. See
 * `restorePending` below.
 */
export function createWorkspaceHandoff(input: {
  /** Called inside the same batch when a seed asks for the editor. */
  enterWorkspace: () => void
}) {
  const [flame, setFlame] = createSignal<FlameDescriptor | undefined>()
  const [tracks, setTracks] = createSignal<TimelineTrack[] | undefined>()
  const [config, setConfig] = createSignal<TimelineConfig | undefined>()
  const [capability, setCapability] = createSignal<string | undefined>()
  const [restoredEntry, setRestoredEntry] = createSignal<
    RecentFlameClaim | undefined
  >()
  const [restoreUnsecured, setRestoreUnsecured] = createSignal<
    UnsecuredReason | undefined
  >()
  /**
   * A restore that has been seeded and not yet taken by the workspace.
   *
   * MainWorkspace is lazy and drains the seat when its chunk resolves, while
   * the welcome grid renders outside that Suspense and is tappable straight
   * away - so a starter flame tapped in that window used to overwrite the
   * restored flame, its tracks, its timeline AND the entry the rescue had
   * just written, and the restored flame never reached the editor at all. For
   * a secured restore that made "Restored your last flame" a false claim;
   * for one the rescue could not shelve it was the loss itself, reached
   * without the user going near Library.
   *
   * So the restore wins, and the seeding that loses is told so rather than
   * disappearing. It is a narrow window - once the workspace has drained the
   * seat, every later pick lands normally and goes through the document
   * replacement like any other.
   */
  let restorePending = false

  /**
   * Hand a flame over. Called with nothing it clears the hand-off, which is
   * what MainWorkspace does once it has consumed one.
   *
   * @returns whether this seeding was applied. False means a pending restore
   * kept the seat; the caller says so rather than leaving a tap that appears
   * to do nothing.
   */
  const seed = (next?: WorkspaceSeed): boolean => {
    if (restorePending && next !== undefined && next.restored !== true) {
      return false
    }
    restorePending = next?.restored === true
    batch(() => {
      setFlame(() => next?.flame)
      setTracks(() => next?.tracks)
      setConfig(() => next?.config)
      setCapability(next?.capability)
      setRestoredEntry(() => next?.restoredEntry)
      setRestoreUnsecured(() => next?.restoreUnsecured)
      // Picking a flame means "take me to the editor". Forcing the tab keeps
      // a stray #home in the URL from leaving Home over the chosen flame.
      if (next?.enterWorkspace) input.enterWorkspace()
    })
    return true
  }

  return {
    flame,
    tracks,
    config,
    capability,
    restoredEntry,
    restoreUnsecured,
    seed,
  }
}
