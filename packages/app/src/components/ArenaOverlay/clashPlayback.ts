// Plays a staged clash once and holds its last frame, then gives the viewer's loop setting back.
import { createEffect, createRoot, on } from 'solid-js'
import type { TimelineState } from '@/contexts/TimelineContext'

type ClashTimeline = Pick<
  TimelineState,
  | 'config'
  | 'setConfig'
  | 'isPlaying'
  | 'currentFrame'
  | 'setCurrentFrame'
  | 'play'
>

/**
 * Start a staged clash's playback, once.
 *
 * The clash keyframes its rounds into the viewer's own timeline, whose default
 * config loops. Left alone, round 1 replays after round 3 while the HUD still
 * says ROUND 3 / 3, and the picture can show the loser winning again after the
 * verdict. So the loop is off for the clash, and when playback stops (at the
 * end, or when the clash is skipped) the playhead parks on the last frame,
 * where the final round resolves, rather than on frame 0 where the timeline
 * puts a stopped playback.
 *
 * Returns the release: it restores the viewer's `loop` and `loopMode` and stops
 * parking the playhead. Call it before staging another clash and whenever the
 * workspace is given back.
 */
export function playClashOnce(timeline: ClashTimeline): () => void {
  const before = timeline.config()
  const { loop, loopMode } = before
  timeline.setConfig({ ...before, loop: false, loopMode: 'off' })

  const dispose = createRoot((dispose) => {
    createEffect(
      on(
        timeline.isPlaying,
        (playing, wasPlaying) => {
          if (wasPlaying && !playing) {
            timeline.setCurrentFrame(timeline.config().endFrame)
          }
        },
        { defer: true },
      ),
    )
    return dispose
  })

  timeline.setCurrentFrame(timeline.config().startFrame)
  timeline.play()

  let released = false
  return () => {
    if (released) return
    released = true
    dispose()
    timeline.setConfig({ ...timeline.config(), loop, loopMode })
  }
}
