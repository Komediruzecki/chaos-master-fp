// What a pick in the load dialog hands the workspace: a bare flame, or a flame
// with the timeline, keyframe tracks and audio wiring it was kept with.
import { deepClone } from '@/utils/clone'
import type { AudioMapping } from '@/flame/schema/audioWiring'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { TimelineConfig, TimelineTrack } from '@/utils/timeline'

export type AnimationLoad = {
  flame: FlameDescriptor
  tracks: TimelineTrack[]
  /** The timeline the animation was authored at, where the source has one
   *  (a stored entry, an imported file). Absent loads keep the workspace's
   *  defaults. */
  config?: TimelineConfig
  /** The audio wiring the flame was kept with. Absent loads keep the
   *  workspace's wiring; audio stays off either way. */
  audio?: AudioMapping
}

/** A flame and what it was kept with: a Recents entry, a parsed file. */
export type KeptFlame = {
  flame: FlameDescriptor
  tracks?: TimelineTrack[]
  config?: TimelineConfig
  audio?: AudioMapping
}

/**
 * The load the workspace applies for a kept flame. Anything beside the flame
 * (tracks, a timeline, audio wiring) makes it an animation load, which is the
 * path that applies them. Copies throughout: Recents hands out shared,
 * read-only entries (utils/recentFlames.ts).
 */
export function flameLoadOf(kept: KeptFlame): FlameDescriptor | AnimationLoad {
  const flame = deepClone(kept.flame)
  const tracks = kept.tracks ? deepClone(kept.tracks) : []
  if (tracks.length === 0 && !kept.config && !kept.audio) return flame
  return {
    flame,
    tracks,
    // The timeline the flame was stored at. An entry saved at 60fps over 300
    // frames came back at 30 over 90 without it.
    ...(kept.config ? { config: deepClone(kept.config) } : {}),
    ...(kept.audio ? { audio: deepClone(kept.audio) } : {}),
  }
}
