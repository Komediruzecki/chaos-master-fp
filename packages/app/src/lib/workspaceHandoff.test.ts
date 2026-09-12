import { createEffect, createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { parseFlameXml } from '@/flame/flameXml'
import { createWorkspaceHandoff } from './workspaceHandoff'
import type { TimelineConfig, TimelineTrack } from '@/utils/timeline'

const flame = parseFlameXml(`<?xml version="1.0" encoding="UTF-8"?>
<flame name="Seed" version="Apophysis 7X" size="800 600"
       center="0 0" scale="200" oversample="1" filter="0.5"
       quality="100" background="0 0 0" brightness="4" gamma="2.2">
  <xform weight="1" color="0" linear="1" coefs="1 0 0 1 0 0"/>
</flame>`)

/** A second flame, so a seeding that lands can be told from one that did not. */
const starter = {
  ...flame,
  metadata: { ...flame.metadata, name: 'Starter' },
}

const tracks: TimelineTrack[] = [
  {
    parameterPath: 'renderSettings.brightness',
    keyframes: [
      { frame: 0, value: 1 },
      { frame: 60, value: 2 },
    ],
  },
]

const config: TimelineConfig = {
  fps: 60,
  timeScale: 1,
  startFrame: 0,
  endFrame: 300,
  loop: false,
}

const handoff = (enterWorkspace = () => undefined) =>
  createWorkspaceHandoff({ enterWorkspace })

describe('the workspace hand-off', () => {
  it('carries a flame with its tracks and its timeline', () => {
    const seat = handoff()
    seat.seed({ flame, tracks, config })
    expect(seat.flame()?.metadata?.name).toBe(flame.metadata?.name)
    expect(seat.tracks()).toEqual(tracks)
    expect(seat.config()).toEqual(config)
  })

  it('leaves nothing standing from the seeding before it', () => {
    // The launch restores a draft, and the welcome grid - live before the
    // workspace chunk has loaded - is tapped before anything consumes it.
    // A seeding that wrote only what it had to say handed that starter
    // flame the restored draft's timeline.
    const seat = handoff()
    seat.seed({ flame, tracks, config, capability: 'animate' })
    seat.seed({ flame })
    expect(seat.flame()).toBeDefined()
    expect(seat.tracks()).toBeUndefined()
    expect(seat.config()).toBeUndefined()
    expect(seat.capability()).toBeUndefined()
  })

  it('empties on a seeding with nothing in it', () => {
    // What MainWorkspace does once it has consumed one.
    const seat = handoff()
    seat.seed({ flame, tracks, config, capability: 'animate' })
    seat.seed()
    expect(seat.flame()).toBeUndefined()
    expect(seat.tracks()).toBeUndefined()
    expect(seat.config()).toBeUndefined()
    expect(seat.capability()).toBeUndefined()
  })

  it('enters the editor only when the seed asks for it', () => {
    let entered = 0
    const seat = handoff(() => {
      entered++
    })
    seat.seed({ flame })
    expect(entered).toBe(0)
    seat.seed({ flame, enterWorkspace: true })
    expect(entered).toBe(1)
  })

  it('will not let a welcome tap wipe a restore nobody has taken yet', () => {
    // MainWorkspace is lazy and drains this seat when its chunk resolves,
    // while the welcome grid renders outside that Suspense and is tappable
    // straight away. A starter flame tapped in that window overwrote the
    // restored flame, its tracks, its timeline AND the entry the rescue had
    // just written into - so the restored flame never reached the editor at
    // all, after the app had said it was restored. For a restore Recents
    // could not take, that is the work itself, lost without the user going
    // near the Library.
    const seat = handoff()
    seat.seed({
      flame,
      tracks,
      config,
      restoredEntry: { id: 'autosave-killed', fingerprint: 'abc' },
      restored: true,
    })

    const seeded = seat.seed({ flame: starter, enterWorkspace: true })

    expect(seeded).toBe(false)
    expect(seat.flame()?.metadata?.name).toBe(flame.metadata?.name)
    expect(seat.tracks()).toEqual(tracks)
    expect(seat.config()).toEqual(config)
    expect(seat.restoredEntry()?.id).toBe('autosave-killed')
  })

  it('does not enter the editor on a pick it refused', () => {
    // The losing side has to lose completely: switching to the workspace on a
    // seeding that was not applied leaves the user in the editor looking at
    // a different flame from the one they tapped, with nothing said.
    let entered = 0
    const seat = handoff(() => {
      entered++
    })
    seat.seed({ flame, restored: true })

    seat.seed({ flame: starter, enterWorkspace: true })

    expect(entered).toBe(0)
  })

  it('carries why a restore is not in Recents', () => {
    // The workspace cannot work this out for itself, and it decides whether
    // the restored document may be marked clean - a clean document is skipped
    // by every writer there is (hooks/useWorkspaceAutosave.ts).
    const seat = handoff()
    seat.seed({ flame, restored: true, restoreUnsecured: 'full' })
    expect(seat.restoreUnsecured()).toBe('full')
  })

  it('takes the next pick once the workspace has drained the restore', () => {
    // The window is narrow on purpose. Once MainWorkspace has consumed the
    // seat - which it signals by seeding nothing - every later pick lands
    // normally and goes through the document replacement like any other.
    const seat = handoff()
    seat.seed({ flame, restored: true, restoreUnsecured: 'refused' })
    seat.seed()

    expect(seat.seed({ flame: starter })).toBe(true)
    expect(seat.flame()?.metadata?.name).toBe(starter.metadata?.name)
    expect(seat.restoreUnsecured()).toBeUndefined()
  })

  it('writes the whole hand-off in one pass', async () => {
    // Torn halfway, a reader sees the new flame beside the timeline the
    // seeding before it left - which is the state the welcome tap opened in.
    // Solid flushes on every write outside a batch, so an unbatched seeding
    // would show this reader each half on its own.
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const seat = handoff()
        const seen: Array<[string | undefined, number | undefined]> = []
        createEffect(() => {
          seen.push([seat.flame()?.metadata?.name, seat.config()?.fps])
        })
        queueMicrotask(() => {
          expect(seen).toHaveLength(1)
          seat.seed({ flame, config })
          expect(seen).toHaveLength(2)
          expect(seen[1]).toEqual([flame.metadata?.name, 60])
          dispose()
          resolve()
        })
      })
    })
  })
})
