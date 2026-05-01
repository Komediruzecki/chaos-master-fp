import { createMemo } from 'solid-js'
import { useTimeline } from '@/contexts/TimelineContext'
import ui from './TimelinePanel.module.css'

export function TimelinePanel() {
  const timeline = useTimeline()!

  const config = createMemo(() => timeline.config())
  const currentFrame = createMemo(() => timeline.currentFrame())
  const isPlaying = createMemo(() => timeline.isPlaying())

  const handlePlayPause = () => {
    timeline.togglePlay()
  }

  const handleStepForward = () => {
    timeline.advanceFrame()
  }
  const handleStepBackward = () => {
    timeline.goBackFrame()
  }
  const handleGoToStart = () => {
    timeline.goToFrame(config().startFrame)
  }
  const handleGoToEnd = () => {
    timeline.goToFrame(config().endFrame)
  }

  const handleFpsChange = (newFps: number) => {
    if (Number.isNaN(newFps)) return
    const clamped = Math.max(1, Math.min(60, Math.round(newFps)))
    timeline.setConfig({ ...config(), fps: clamped })
  }

  const handleEndFrameChange = (newEnd: number) => {
    if (Number.isNaN(newEnd)) return
    const clamped = Math.max(1, Math.round(newEnd))
    timeline.setConfig({ ...config(), endFrame: clamped })
  }

  const handleLoopToggle = () => {
    timeline.setConfig({ ...config(), loop: !config().loop })
  }

  const handleTimeScaleChange = (newTimeScale: number) => {
    if (Number.isNaN(newTimeScale)) return
    const clamped = Math.max(1, Math.min(10, Math.round(newTimeScale)))
    timeline.setConfig({ ...config(), timeScale: clamped })
  }

  return (
    <div class={ui.panel} data-testid="timeline-panel">
      <div class={ui.toolbar}>
        <div class={ui.transportControls}>
          <button
            class={ui.transportBtn}
            onClick={handleGoToStart}
            title="Go to start"
            data-testid="go-to-start"
          >
            &lArr;
          </button>
          <button
            class={ui.transportBtn}
            onClick={handleStepBackward}
            title="Previous frame"
            data-testid="previous-frame"
          >
            &laquo;
          </button>
          <button
            class={ui.transportBtn}
            classList={{ active: isPlaying() }}
            onClick={handlePlayPause}
            title="Play/Pause"
            data-testid={isPlaying() ? 'pause' : 'play'}
          >
            {isPlaying() ? '\u23F8' : '\u25B6'}
          </button>
          <button
            class={ui.transportBtn}
            onClick={handleStepForward}
            title="Next frame"
            data-testid="next-frame"
          >
            &raquo;
          </button>
          <button
            class={ui.transportBtn}
            onClick={handleGoToEnd}
            title="Go to end"
            data-testid="go-to-end"
          >
            &rArr;
          </button>
          <label class={ui.labeledInput}>
            <span>Loop</span>
            <input
              type="checkbox"
              checked={config().loop}
              onChange={handleLoopToggle}
              data-testid="loop-toggle"
            />
          </label>
        </div>
        <div class={ui.frameInfo}>
          <span class={ui.frameDisplay}>
            <span data-testid="current-frame">{currentFrame()}</span> /
            <span data-testid="end-frame">{config().endFrame}</span>
          </span>
        </div>
        <div class={ui.settingsControls}>
          <label class={ui.labeledInput}>
            <span>FPS</span>
            <input
              type="number"
              class={ui.numberInput}
              value={config().fps}
              min={1}
              max={60}
              onBlur={(e) => {
                handleFpsChange(Number(e.currentTarget.value))
              }}
              data-testid="fps-input"
            />
          </label>
          <label class={ui.labeledInput}>
            <span>Frames</span>
            <input
              type="number"
              class={ui.numberInput}
              value={config().endFrame}
              min={1}
              onBlur={(e) => {
                handleEndFrameChange(Number(e.currentTarget.value))
              }}
              data-testid="end-frame-input"
            />
          </label>
          <label class={ui.labeledInput}>
            <span>Speed</span>
            <input
              type="number"
              class={ui.numberInput}
              value={config().timeScale}
              min={1}
              max={10}
              onBlur={(e) => {
                handleTimeScaleChange(Number(e.currentTarget.value))
              }}
              data-testid="time-scale-input"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
