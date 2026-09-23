/**
 * Space under an Arcade lock, through the workspace's own keyboard hook and a
 * real timeline wired to the recorder the way MainWorkspace wires it.
 *
 * While the agent owns the screen the viewer is watching a take being made:
 * Space must neither start nor stop the playback the agent is driving, and
 * must not put a step into its take. A seat lock (a duel) is the opposite
 * case, as it is for the command shortcuts: the viewer is playing the other
 * seat and keeps their keyboard.
 */
import '@/commands/builtins'
import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetPilot, startPilot } from '@/arcade/pilot'
import { executeCommand } from '@/commands/registry'
import { examples } from '@/flame/examples'
import { cancelSessionRecording, startSessionRecording, stopSessionRecording, } from '@/recorder/recorder'
import { createRecorderAwareTimeline } from '@/recorder/timelineActions'
import { createTimelineState } from '@/utils/timeline'
import { createMockCommandContext } from '@/webmcp/testUtils'
import { useWorkspaceShortcuts } from './useWorkspaceShortcuts'
import type { SeatId } from '@/seats/seatId'

function drive(lock: 'screen' | 'seat', seatId: SeatId) {
  startPilot({
    mode: lock === 'screen' ? 'cinema' : 'duel',
    title: 'Driving',
    stepBudget: 10,
    allowed: ['flame.', 'timeline.'],
    qualityRankAtStart: 1,
    seatId,
    lock,
  })
}

/** Disposed after each test, so a failed assertion cannot leave a listener
 *  behind to answer the next test's Space a second time. */
let disposeHook: (() => void) | undefined

/** The hook mounted over a real timeline. Effects created inside
 *  `createRoot` flush as it returns, so the listener exists once we are out. */
function mount() {
  const timeline = createTimelineState()
  const ctx = createMockCommandContext()
  const recorderTimeline = createRecorderAwareTimeline(
    timeline,
    (id, ...args) => {
      executeCommand(id, ctx, ...args)
    },
  )
  disposeHook = createRoot((dispose) => {
    useWorkspaceShortcuts({
      getCmdContext: () => ctx,
      sidebarDiffView: () => null,
      closeSidebarDiff: () => {},
      toggleSidebarAsAuthoredAction: () => {},
      undoRouter: { canUndo: () => false, canRedo: () => false },
      theme: () => 'dark',
      setTheme: () => {},
      targetedParameter: () => null,
      recorderTimeline,
      timeline,
      showTimeline: () => true,
      animationEnabled: () => true,
    })
    return dispose
  })
  return timeline
}

/** Space as the browser delivers it, returned so a test can ask whether the
 *  app claimed it. */
function pressSpace(): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    code: 'Space',
    key: ' ',
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(ev)
  return ev
}

function stopTake() {
  const session = stopSessionRecording()
  if (!session) throw new Error('expected a finished take')
  return session
}

describe('Space under an Arcade lock', () => {
  afterEach(() => {
    disposeHook?.()
    disposeHook = undefined
    cancelSessionRecording()
    resetPilot()
  })

  it('leaves the playback alone while the agent owns the screen, and records nothing', () => {
    const timeline = mount()
    startSessionRecording(examples.example1)
    drive('screen', 'player')

    const ev = pressSpace()

    expect(timeline.isPlaying()).toBe(false)
    // Not claimed either, so a focused Stop button still gets its Space.
    expect(ev.defaultPrevented).toBe(false)
    const session = stopTake()
    expect(session.actions).toEqual([])
    expect(session.unnamedWriteCount).toBe(0)
  })

  it('lets nothing further along act on Space while the agent owns the screen', () => {
    // Where the audio panel listens: on window, after the workspace. It
    // toggles its track on Space, and a viewer can leave it open, track
    // loaded, when a session starts.
    mount()
    drive('screen', 'player')
    const later = vi.fn()
    window.addEventListener('keydown', later)
    try {
      pressSpace()
    } finally {
      window.removeEventListener('keydown', later)
    }

    expect(later).not.toHaveBeenCalled()
  })

  it('plays and records the step once the viewer has the screen back', () => {
    const timeline = mount()
    drive('screen', 'player')
    resetPilot()
    startSessionRecording(examples.example1)

    const ev = pressSpace()

    expect(timeline.isPlaying()).toBe(true)
    expect(ev.defaultPrevented).toBe(true)
    const session = stopTake()
    expect(session.actions.map(({ id, args }) => [id, ...args])).toEqual([
      ['timeline.setPlaying', true, 0],
    ])
    expect(session.unnamedWriteCount).toBe(0)
  })

  it('keeps Space for the viewer playing the other seat of a duel', () => {
    const timeline = mount()
    drive('seat', 'rival')

    pressSpace()

    expect(timeline.isPlaying()).toBe(true)
  })
})
