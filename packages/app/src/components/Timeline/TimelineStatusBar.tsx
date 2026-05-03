import { createMemo } from 'solid-js'
import { useTimeline } from '@/contexts/TimelineContext'
import { useKeyframeTarget } from '@/contexts/KeyframeTargetContext'
import { TIMELINE_PARAMETERS } from '@/utils/timeline'
import ui from './TimelineStatusBar.module.css'

export function TimelineStatusBar() {
  const timeline = useTimeline()!
  const { targetedParameter } = useKeyframeTarget()

  const config = createMemo(() => timeline.config())
  const currentFrame = createMemo(() => timeline.currentFrame())
  const isPlaying = createMemo(() => timeline.isPlaying())
  const tracks = createMemo(() => timeline.tracks())
  const tracksCount = createMemo(() => tracks().length)

  const selectedPath = () => targetedParameter() ?? 'exposure'

  const currentPath = () => selectedPath()
  const currentValue = createMemo(() => timeline.resolveValueAtPath(currentPath(), currentFrame()))

  const isNumberValue = createMemo(() => {
    const param = TIMELINE_PARAMETERS.find((p) => p.path === currentPath())
    return param?.type === 'number'
  })

  const track = createMemo(() => {
    const path = currentPath()
    return tracks().find((t) => t.parameterPath === path)
  })

  const keyframes = createMemo(() => {
    const t = track()
    return t?.keyframes || []
  })

  const sortedKeyframes = createMemo(() => {
    return [...keyframes()].sort((a, b) => a.frame - b.frame)
  })

  const valueDisplay = createMemo(() => {
    const val = currentValue()
    if (val === null || val === undefined) return 'No value'

    if (Array.isArray(val)) {
      return `[${val.map((v) => v.toFixed(2)).join(', ')}]`
    }

    if (typeof val === 'string') {
      return `"${val}"`
    }

    return val.toFixed(isNumberValue() ? 2 : 4)
  })

  return (
    <div class={ui.statusBar}>
      <div class={ui.statusSection}>
        <span class={ui.statusLabel}>Status:</span>
        <span class={ui.statusValue}>
          <span class={ui.statusText} classList={{ [ui.isPlaying]: isPlaying() }}>
            {isPlaying() ? 'Playing' : 'Paused'}
          </span>
        </span>
      </div>

      <div class={ui.statusSection}>
        <span class={ui.statusLabel}>Frame:</span>
        <span class={ui.statusValue}>
          {currentFrame()}/{config().endFrame}
        </span>
      </div>

      <div class={ui.statusSection}>
        <span class={ui.statusLabel}>Tracks:</span>
        <span class={ui.statusValue}>{tracksCount()}</span>
      </div>

      <div class={ui.statusSection}>
        <span class={ui.statusLabel}>Parameter:</span>
        <span class={ui.statusValue} title={currentPath()} style={{ maxWidth: '200px' }}>
          {currentPath()}
        </span>
      </div>

      <div class={ui.statusSection}>
        <span class={ui.statusLabel}>Value:</span>
        <span class={ui.statusValue code}>{valueDisplay()}</span>
      </div>

      {sortedKeyframes().length >= 2 && isNumberValue() && (
        <div class={ui.statusSection}>
          <span class={ui.statusLabel}>Curve:</span>
          <span class={ui.statusValue code}>
            {sortedKeyframes()[1]?.easing || 'Linear'}
          </span>
        </div>
      )}
    </div>
  )
}
