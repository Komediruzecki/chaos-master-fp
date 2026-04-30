import { createMemo } from 'solid-js'
import { useTimeline } from '@/contexts/TimelineContext'
import ui from './TimelineRuler.module.css'

export function TimelineRuler() {
  const timeline = useTimeline()!

  const config = createMemo(() => timeline.config())
  const tracks = createMemo(() => timeline.tracks())

  const keyframeFramesArr = createMemo(() => {
    const frames = new Set<number>()
    for (const track of tracks()) {
      for (const kf of track.keyframes) {
        frames.add(kf.frame)
      }
    }
    return Array.from(frames).sort((a, b) => a - b)
  })

  const frameWidth = 30 // pixels per frame
  const totalWidth = createMemo(() => config().endFrame * frameWidth)

  return (
    <div
      class={ui.ruler}
      style={{ width: `${totalWidth()}px` }}
      data-testid="timeline-ruler"
    >
      <div class={ui.markers}>
        {keyframeFramesArr().map((frame) => (
          <div
            data-key={frame}
            class={ui.keyframeMarker}
            style={{ left: `${frame * frameWidth}px` }}
            data-testid={`frame-marker-${frame}`}
          />
        ))}
      </div>
      <div class={ui.scale}>
        {Array.from({ length: config().endFrame + 1 }, (_, i) => i).map(
          (frame) => (
            <span
              data-keyframe={frame}
              style={{ width: `${frameWidth}px` }}
              data-testid={`frame-number-${frame}`}
            >
              {frame}
            </span>
          ),
        )}
      </div>
    </div>
  )
}
