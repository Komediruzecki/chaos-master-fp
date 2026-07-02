import { persistentSignal } from './persistentSignal'
import type { TimelineState } from './timeline'

/**
 * Opt-in "track changes" recording (default OFF): while enabled, edits drop a
 * keyframe at the current frame for every value they change — scrub/slider
 * edits, dice randomizes and affine/color graph drags alike — so animating is
 * just "toggle the diamond, move things, step frames, move again". Unlike the
 * timeline's Auto mode (which only re-records already-animated params), this
 * also creates the first keyframe for untouched params.
 */
export const [keyframeOnChange, setKeyframeOnChange] = persistentSignal(
  'editor/keyframe-on-change',
  false,
)

/** When track-changes is on, keyframe each parameter path at the current
 *  frame. Call AFTER applying the value change so the new values are captured.
 *  No-op when the option is off or there is no timeline. */
export function keyframeChangedParams(
  timeline: TimelineState | null | undefined,
  paths: readonly string[],
) {
  if (!timeline || !keyframeOnChange()) return
  for (const path of paths) {
    timeline.addKeyframeAtCurrentFrame(path)
  }
}
