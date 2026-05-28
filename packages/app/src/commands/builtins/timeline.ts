import { registerCommand } from '../registry'

registerCommand({
  id: 'timeline.setAnimationEnabled',
  label: 'Toggle Animation',
  description: 'Enable or disable timeline animation playback',
  shortcut: 'Ctrl+T',
  execute(ctx, enabled?: unknown) {
    if (typeof enabled === 'boolean') {
      ctx.timeline.setAnimationEnabled(enabled)
    } else {
      ctx.timeline.setAnimationEnabled((prev) => !prev)
    }
  },
})

registerCommand({
  id: 'timeline.setDuration',
  label: 'Set Animation Duration',
  description: 'Set the animation duration in frames',
  execute(ctx, duration?: unknown) {
    if (typeof duration === 'number' && duration > 0) {
      ctx.timeline.setDuration(duration)
    }
  },
})

registerCommand({
  id: 'timeline.setCurrentFrame',
  label: 'Set Current Frame',
  description: 'Jump to a specific frame in the timeline',
  execute(ctx, frame?: unknown) {
    if (typeof frame === 'number' && frame >= 0) {
      ctx.timeline.setCurrentFrame(frame)
    }
  },
})
