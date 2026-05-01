import { createSignal, Show } from 'solid-js'
import { useTimeline } from '@/contexts/TimelineContext'
import { Cross } from '@/icons'
import { KeyframeEditor } from './KeyframeEditor'
import { TimelinePanel } from './TimelinePanel'
import { TimelineRuler } from './TimelineRuler'
import ui from './TimelineSection.module.css'

export interface TimelineSectionProps {
  onEnterAnimation?: () => void
}

export function TimelineSection({ onEnterAnimation }: TimelineSectionProps) {
  const timeline = useTimeline()!
  const [collapsed, setCollapsed] = createSignal(false)
  const isPlaying = () => timeline.isPlaying()

  return (
    <div class={ui.section} data-testid="timeline-section">
      <div class={ui.header}>
        <div class={ui.headerLeft}>
          <h3 class={ui.title}>Timeline</h3>
          <span class={ui.isPlayingIndicator} data-testid="timeline-playing">
            {isPlaying() ? '●' : '○'}
          </span>
        </div>
        <div class={ui.headerRight}>
          <button
            class={ui.iconButton}
            onClick={() => setCollapsed(!collapsed())}
            title={collapsed() ? 'Expand' : 'Collapse'}
            data-testid="timeline-collapse"
          >
            <Cross />
          </button>
        </div>
      </div>

      <Show when={!collapsed()}>
        <div class={ui.content}>
          <button class={ui.enterAnimationButton} onClick={onEnterAnimation}>
            Enter Animation Mode
          </button>

          <KeyframeEditor />

          <TimelineRuler />

          <TimelinePanel />
        </div>
      </Show>
    </div>
  )
}
