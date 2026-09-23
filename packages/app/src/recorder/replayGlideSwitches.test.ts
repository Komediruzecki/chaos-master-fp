import '@/commands/builtins'
import { createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeReplayCommand } from '@/commands/registry'
import { examples } from '@/flame/examples'
import { glideEnabled, glideQualityPreference, restoreGlideSwitches, } from '@/flame/glide/runtime'
import { deepClone } from '@/utils/clone'
import { createSessionPlayer, MIN_STEP_GAP_MS } from './player'
import { cancelSessionRecording } from './recorder'
import { createReplayVideoDriver } from './replayVideo'
import { SESSION_FORMAT_VERSION } from './schema'
import { replaySessionHeadless } from './synthesize/replaySandbox'
import type { ReplayTarget } from './replay'
import type { RecordedAction, RecordedSession } from './schema'
import type { CommandContext } from '@/commands/types'

/**
 * A take may flip the Glide switches (`glide.setEnabled`, `glide.setQuality`).
 * While it replays they follow the take; when the replay ends, however it
 * ends, they are the viewer's again. Worlds apart from the workspace (the
 * artwork export, the synthesize sandbox) never touch them at all.
 */

const VIEWER = { enabled: false, quality: 'balanced' } as const

function makeSession(actions: RecordedAction[]): RecordedSession {
  return {
    version: SESSION_FORMAT_VERSION,
    app: { version: 'test', flameSchemaVersion: '1.0' },
    createdAt: new Date(0).toISOString(),
    initial: deepClone(examples.example1),
    actions,
    unnamedWriteCount: 0,
  }
}

/** Glide on, full quality, then one more step the replay can stop or fail on. */
const take = makeSession([
  { t: 0, id: 'glide.setEnabled', args: [true] },
  { t: 1000, id: 'glide.setQuality', args: ['full'] },
  { t: 2000, id: 'glide.setQuality', args: ['responsive'] },
])

const switches = () => ({
  enabled: glideEnabled(),
  quality: glideQualityPreference(),
})

/** A workspace-shaped target whose commands reach the live switches. */
function makeTarget(failOn?: number) {
  const ctx = {} as CommandContext
  let takeover: (() => void) | undefined
  let executed = 0
  const target: ReplayTarget = {
    loadInitial: () => {},
    execute: (id, args) => {
      if (executed++ === failOn) throw new Error('boom')
      return executeReplayCommand(id, ctx, ...args)
    },
    beginBatch: (onTakeover) => {
      takeover = onTakeover
    },
    endBatch: () => {
      takeover = undefined
    },
  }
  return { target, takeOver: () => takeover?.() }
}

/** Run the replay to the moment step `index` has applied. */
function playTo(index: number) {
  vi.advanceTimersByTime(0)
  for (let step = 0; step < index; step++) vi.advanceTimersByTime(1000)
}

beforeEach(() => {
  vi.useFakeTimers()
  restoreGlideSwitches(VIEWER)
})
afterEach(() => {
  cancelSessionRecording()
  vi.useRealTimers()
  restoreGlideSwitches({ enabled: false, quality: 'auto' })
})

describe('the replay player and the Glide switches', () => {
  it('follows the take while it plays and hands them back when it finishes', () => {
    createRoot((dispose) => {
      const player = createSessionPlayer(take, makeTarget().target)
      player.play()
      playTo(1)
      expect(switches()).toEqual({ enabled: true, quality: 'full' })
      vi.advanceTimersByTime(5000)
      expect(player.isFinished()).toBe(true)
      expect(switches()).toEqual(VIEWER)
      dispose()
    })
  })

  it('hands them back when the replay is closed midway', () => {
    createRoot((dispose) => {
      const player = createSessionPlayer(take, makeTarget().target)
      player.play()
      playTo(1)
      player.stop()
      expect(switches()).toEqual(VIEWER)
      dispose()
    })
  })

  it('hands them back when a step fails', () => {
    createRoot((dispose) => {
      const errors: string[] = []
      const player = createSessionPlayer(take, makeTarget(2).target, {
        onError: (message) => errors.push(message),
      })
      player.play()
      playTo(2)
      expect(errors).toEqual(['Step 3 could not be replayed: boom'])
      expect(switches()).toEqual(VIEWER)
      dispose()
    })
  })

  it('hands them back when the viewer takes the document over', () => {
    createRoot((dispose) => {
      const { target, takeOver } = makeTarget()
      const player = createSessionPlayer(take, target)
      player.play()
      playTo(1)
      takeOver()
      expect(player.isPlaying()).toBe(false)
      expect(switches()).toEqual(VIEWER)
      dispose()
    })
  })

  it("keeps the take's switches over a replay Pause, until the replay ends", () => {
    createRoot((dispose) => {
      const player = createSessionPlayer(take, makeTarget().target)
      player.play()
      playTo(1)
      player.pause()
      expect(switches()).toEqual({ enabled: true, quality: 'full' })
      // Resume carries on with them, and still owes the viewer theirs.
      player.play()
      expect(switches()).toEqual({ enabled: true, quality: 'full' })
      vi.advanceTimersByTime(MIN_STEP_GAP_MS * 3)
      expect(player.isFinished()).toBe(true)
      expect(switches()).toEqual(VIEWER)
      dispose()
    })
  })

  it('sets them as the take had them at the step a seek lands on', () => {
    createRoot((dispose) => {
      const player = createSessionPlayer(take, makeTarget().target)
      player.seek(2)
      expect(switches()).toEqual({ enabled: true, quality: 'responsive' })
      player.seek(0)
      expect(switches()).toEqual({ enabled: true, quality: 'balanced' })
      player.seek(-1)
      expect(switches()).toEqual(VIEWER)
      player.seek(1)
      player.stop()
      expect(switches()).toEqual(VIEWER)
      dispose()
    })
  })
})

describe('replay worlds apart from the workspace', () => {
  it("leaves the viewer's switches alone while the artwork export replays", () => {
    const driver = createReplayVideoDriver(take)
    driver.advanceTo(take.actions.length - 1)
    expect(switches()).toEqual(VIEWER)
  })

  it('leaves them alone while the synthesize sandbox checks a take', () => {
    expect(replaySessionHeadless(take)).toBeDefined()
    expect(switches()).toEqual(VIEWER)
  })
})
