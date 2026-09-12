import { batch, createSignal } from 'solid-js'
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
  /** Whether this also means "take me to the editor". */
  readonly enterWorkspace?: boolean
}

/**
 * The one-shot hand-off between whoever picked a flame and the workspace
 * that opens it: App.tsx owns one of these and MainWorkspace drains it.
 *
 * Every field is written on every seeding, including the ones the caller has
 * nothing to say about. A path that set only some of them left the rest
 * standing from whoever seeded last, and the welcome grid is live before the
 * workspace chunk has finished loading - so a starter flame tapped in that
 * window arrived carrying the restored draft's timeline, and the entry that
 * draft had just been rescued into. One writer, every field, one batch.
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

  /**
   * Hand a flame over. Called with nothing it clears the hand-off, which is
   * what MainWorkspace does once it has consumed one.
   */
  const seed = (next?: WorkspaceSeed) => {
    batch(() => {
      setFlame(() => next?.flame)
      setTracks(() => next?.tracks)
      setConfig(() => next?.config)
      setCapability(next?.capability)
      setRestoredEntry(() => next?.restoredEntry)
      // Picking a flame means "take me to the editor". Forcing the tab keeps
      // a stray #home in the URL from leaving Home over the chosen flame.
      if (next?.enterWorkspace) input.enterWorkspace()
    })
  }

  return { flame, tracks, config, capability, restoredEntry, seed }
}
