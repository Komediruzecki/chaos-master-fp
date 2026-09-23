/**
 * A live timeline as a replay paces it: the `playback` a replay target hands
 * the player (recorder/player.ts), shared by the workspace and its tests so
 * both hold the playhead the same way.
 *
 * While the replay plays a window it sets `pacedPlayback`, which keeps the
 * render loop's own clock off the playhead (flame/Flam3.tsx), and moves the
 * playhead itself at the pace the take recorded. Every write is suppressed:
 * the replay's transport is not a step of anything.
 */

import { batch } from 'solid-js'
import { withRecordingSuppressed } from './recorder'
import type { ReplayPlayback } from './replay'
import type { TimelineState } from '@/utils/timeline'

export function timelineReplayPlayback(
  timeline: TimelineState,
): ReplayPlayback {
  return {
    read: () => ({ ...timeline.config(), frame: timeline.currentFrame() }),
    hold: (frame, playing) => {
      withRecordingSuppressed(() => {
        batch(() => {
          timeline.setPacedPlayback(playing)
          // Play first: a non-looping Play on the last frame starts over, and
          // the playhead belongs where the replay says, not at the start.
          if (playing && !timeline.isPlaying()) timeline.play()
          if (!playing && timeline.isPlaying()) timeline.pause()
          if (timeline.currentFrame() !== frame) timeline.setCurrentFrame(frame)
          timeline.setPreviewHeld(true)
        })
      })
    },
    release: () => {
      timeline.setPacedPlayback(false)
    },
  }
}
