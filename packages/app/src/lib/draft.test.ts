import { createRoot } from 'solid-js'
import { createStore, unwrap } from 'solid-js/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFlameXml } from '@/flame/flameXml'
import { useWorkspaceAutosave } from '@/hooks/useWorkspaceAutosave'
import { clearRecentFlames, loadRecentFlames, upsertRecentFlame, } from '@/utils/recentFlames'
import { safeSetItem } from '@/utils/storage'
import { clearDraft, DRAFT_KEY, hasSharePayload, installDraftBackup, readDraft, saveDraft, takeDraftForLaunch, } from './draft'
import { useLifecyclePorts } from './lifecycle'
import type { LifecyclePorts } from '@chaos-master/mobile-runtime/lifecycle'
import type { DraftState } from './draft'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { TimelineConfig, TimelineTrack } from '@/utils/timeline'

// localStorage is not usable in this runtime (the same reason
// TouchSurface.test.tsx mocks this module), so the draft and Recents both
// round-trip through an in-memory store. What is under test is the app's
// envelope, not the browser's.
const store = new Map<string, string>()
/** Quota, private mode, a locked-down WebView: storage that says no. */
let storageRefuses = false
vi.mock('@/utils/storage', () => ({
  safeGetItem: (key: string) => store.get(key) ?? null,
  safeSetItem: (key: string, value: string) => {
    if (storageRefuses) return false
    store.set(key, value)
    return true
  },
  safeRemoveItem: (key: string) => {
    store.delete(key)
  },
}))

/** Where Recents lives, for seeding entries the loaders disagree about. */
const RECENTS_KEY = 'chaos-master-recent-flames'

const FLAME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<flame name="Draft" version="Apophysis 7X" size="800 600"
       center="0 0" scale="200" oversample="1" filter="0.5"
       quality="100" background="0 0 0" brightness="4" gamma="2.2">
  <xform weight="1" color="0" linear="1" coefs="1 0 0 1 0 0"/>
</flame>`

// parseFlameXml does not carry the file's name into the metadata; the name is
// what this test follows through the round trip, so set it here.
const parsed = parseFlameXml(FLAME_XML)
const flame: FlameDescriptor = {
  ...parsed,
  metadata: { ...parsed.metadata, name: 'Draft' },
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
  timeScale: 2,
  startFrame: 0,
  endFrame: 300,
  loop: false,
  autoFps: false,
  loopMode: 'seamless',
}

/** What the workspace hands the draft: a flame, its animation, its entry. */
const state = (overrides: Partial<DraftState> = {}): DraftState => ({
  flame,
  tracks,
  config,
  sessionId: 'autosave-session',
  ...overrides,
})

/** A draft already in storage, as a killed session would have left it. */
const seedDraft = (
  overrides: {
    sessionId?: string
    savedAt?: number
    tracks?: TimelineTrack[]
  } = {},
) => {
  safeSetItem(
    DRAFT_KEY,
    JSON.stringify({
      flame,
      savedAt: overrides.savedAt ?? Date.now(),
      animation: { tracks: overrides.tracks ?? tracks, config },
      sessionId: overrides.sessionId ?? 'autosave-killed',
    }),
  )
}

const reset = () => {
  storageRefuses = false
  clearDraft()
  clearRecentFlames()
}

// Every test starts on empty storage. A trailing reset inside each one is
// skipped by the failure it is meant to clean up after, so the next test
// then runs on the wreckage and reports something that is not its own.
afterEach(reset)

describe('the background draft', () => {
  it('comes back with its flame, its tracks and its entry', () => {
    saveDraft(state(), true)
    const draft = readDraft()
    expect(draft?.flame.metadata?.name).toBe('Draft')
    // The keyframes come back through the same validation an imported file
    // goes through, which fills in the defaults a track may omit; what has to
    // survive is the track and its values.
    expect(draft?.tracks?.[0]?.parameterPath).toBe(tracks[0]?.parameterPath)
    expect(
      draft?.tracks?.[0]?.keyframes.map((key) => [key.frame, key.value]),
    ).toEqual([
      [0, 1],
      [60, 2],
    ])
    expect(typeof draft?.savedAt).toBe('number')
    takeDraftForLaunch({ native: true, search: '' })
    expect(loadRecentFlames()[0]?.id).toBe('autosave-session')
  })

  it('saves a flame with no animation, and its timeline with it', () => {
    // The config decides how long the animation is and how fast it runs, and
    // a flame with no tracks still has one: leaving it out sent every
    // restored animation back at the hand-off's reset, 30fps over 90 frames.
    saveDraft(state({ tracks: [] }), true)
    const draft = readDraft()
    expect(draft?.flame.metadata?.name).toBe('Draft')
    expect(draft?.tracks).toBeUndefined()
    expect(draft?.config?.fps).toBe(60)
    expect(draft?.config?.endFrame).toBe(300)
    expect(draft?.config?.loopMode).toBe('seamless')
  })

  it('is not a crash when the value is corrupt', () => {
    safeSetItem(DRAFT_KEY, '{"flame": nonsense')
    expect(readDraft()).toBeUndefined()
    expect(takeDraftForLaunch({ native: true, search: '' })).toBeUndefined()
    safeSetItem(DRAFT_KEY, '{"hello":"world"}')
    expect(readDraft()).toBeUndefined()
  })

  it('writes nothing for a workspace with nothing unsaved in it', () => {
    // Android fires pause for every share sheet and permission dialog, so an
    // untouched flame would otherwise become a draft on the first background
    // and be offered back on every cold start after it.
    saveDraft(state(), false)
    expect(readDraft()).toBeUndefined()
  })

  it('leaves a stored draft alone when the workspace looks clean', () => {
    // THE RULE. A pause that finds nothing unsaved has learned nothing about
    // the draft already in storage, and every earlier version of this deleted
    // it here - which is how a restored session was destroyed by any share
    // sheet that followed it, three fix passes running.
    seedDraft()
    saveDraft(
      state({
        flame: { ...flame, metadata: { ...flame.metadata, name: 'Clean' } },
      }),
      false,
    )
    expect(readDraft()?.flame.metadata?.name).toBe('Draft')
  })

  it('replaces a draft only with newer unsaved work', () => {
    seedDraft()
    const edited = state({
      flame: { ...flame, metadata: { ...flame.metadata, name: 'Edited' } },
    })
    saveDraft(edited, true)
    expect(readDraft()?.flame.metadata?.name).toBe('Edited')
  })

  it('does not rewrite what it already holds', () => {
    // Pause fires for every share sheet, so the same second of work would be
    // rewritten a dozen times over.
    saveDraft(state(), true)
    const first = readDraft()?.savedAt
    saveDraft(state(), true)
    expect(readDraft()?.savedAt).toBe(first)
  })

  it('counts a change to only the timeline as work', () => {
    saveDraft(state(), true)
    saveDraft(state({ config: { ...config, endFrame: 600 } }), true)
    expect(readDraft()?.config?.endFrame).toBe(600)
  })

  it('ignores a config that does not validate, and keeps the flame', () => {
    // The config decides what playback does, so it goes through the same
    // validation the tracks do: fps 0 would stop the timeline dead.
    safeSetItem(
      DRAFT_KEY,
      JSON.stringify({
        flame,
        savedAt: Date.now(),
        animation: { tracks, config: { fps: 0, endFrame: -5 } },
      }),
    )
    const draft = readDraft()
    expect(draft?.flame.metadata?.name).toBe('Draft')
    expect(draft?.tracks?.[0]?.parameterPath).toBe(tracks[0]?.parameterPath)
    expect(draft?.config).toBeUndefined()
  })
})

/** A fake platform, so what fires here is the pause the app subscribes to. */
function fakePlatform() {
  const pauses = new Set<() => void>()
  const ports: LifecyclePorts = {
    onBackButton: () => () => undefined,
    onPause: (callback: () => void) => {
      pauses.add(callback)
      return () => pauses.delete(callback)
    },
    onResume: () => () => undefined,
    minimizeApp: () => Promise.resolve(),
  }
  useLifecyclePorts(ports)
  return {
    pause: () => {
      pauses.forEach((callback) => {
        callback()
      })
    },
  }
}

describe('the pause backup', () => {
  it('writes what the pause finds, timeline and all', () => {
    // The path the app actually takes: one reader, the editor's dirty flag,
    // and a write when the platform says the app is going away.
    const platform = fakePlatform()
    let current = state()
    let unsaved = false
    const backup = installDraftBackup({
      native: true,
      read: () => current,
      unsaved: () => unsaved,
    })

    platform.pause()
    expect(readDraft()).toBeUndefined()

    unsaved = true
    current = state({ config: { ...config, fps: 24, endFrame: 480 } })
    platform.pause()
    const draft = readDraft()
    expect(draft?.config?.fps).toBe(24)
    expect(draft?.config?.endFrame).toBe(480)

    backup.dispose()
  })

  it('does nothing on the web, where nothing reads a draft back', () => {
    const platform = fakePlatform()
    const backup = installDraftBackup({
      native: false,
      read: () => state(),
      unsaved: () => true,
    })

    platform.pause()
    expect(readDraft()).toBeUndefined()
    backup.dispose()
  })
})

describe('what a launch does with the draft', () => {
  it('rescues it into Recents and hands it over', () => {
    // The welcome screen is deliberately not an input: it shows on every
    // launch until the user ticks "Don't show again", and the workspace is
    // mounted behind it, so a restored flame is waiting once they enter.
    seedDraft()
    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.flame.metadata?.name).toBe('Draft')
    // No entry id rides back with it: the workspace opens its own, so an
    // autosave can never land on an entry the rescue did not write.
    expect(restored && 'sessionId' in restored).toBe(false)
    expect(restored?.tracks?.[0]?.parameterPath).toBe(tracks[0]?.parameterPath)
    expect(restored?.config?.endFrame).toBe(300)

    const recents = loadRecentFlames()
    expect(recents.map((entry) => entry.id)).toEqual(['autosave-killed'])
    expect(recents[0]?.flame.metadata?.name).toBe('Draft')
    expect(recents[0]?.tracks?.[0]?.parameterPath).toBe(
      tracks[0]?.parameterPath,
    )
    // Spent: the work is somewhere it can be found by hand.
    expect(readDraft()).toBeUndefined()
  })

  it('updates the killed session entry instead of adding a second', () => {
    // The session id regenerated on every restore, so the rescue filed the
    // same work under a new name and Recents grew a duplicate per launch.
    seedDraft({ sessionId: 'autosave-killed', savedAt: 2000 })
    takeDraftForLaunch({ native: true, search: '' })
    seedDraft({ sessionId: 'autosave-killed', savedAt: 3000 })
    takeDraftForLaunch({ native: true, search: '' })
    expect(loadRecentFlames()).toHaveLength(1)
  })

  it('never writes over a newer Recents entry of the same session', () => {
    // That session's autosave writes to this entry too. A draft written
    // before the last autosave is the older half of one piece of work.
    seedDraft({ sessionId: 'autosave-killed', savedAt: 1000 })
    takeDraftForLaunch({ native: true, search: '' })
    const rescued = loadRecentFlames()[0]?.savedAt ?? 0
    seedDraft({ sessionId: 'autosave-killed', savedAt: 1 })
    takeDraftForLaunch({ native: true, search: '' })
    expect(loadRecentFlames()[0]?.savedAt).toBe(rescued)
  })

  it('declines to restore over a link, and leaves the draft where it is', () => {
    // Restoring over the link would replace what it was opened for. Dropping
    // the draft instead lost a friend's tap: the work was gone from storage
    // and had never reached Recents.
    seedDraft()
    expect(
      takeDraftForLaunch({ native: true, search: '?s=abc' }),
    ).toBeUndefined()
    expect(readDraft()?.flame.metadata?.name).toBe('Draft')
    expect(loadRecentFlames()).toHaveLength(1)
  })

  it('adopts nothing on the web, and leaves what is there alone', () => {
    seedDraft()
    expect(takeDraftForLaunch({ native: false, search: '' })).toBeUndefined()
    expect(readDraft()?.flame.metadata?.name).toBe('Draft')
    expect(loadRecentFlames()).toHaveLength(0)
  })

  it('rescues a draft whose envelope carries no usable clock', () => {
    // `savedAt` missing, then not a number. Reading either as zero handed
    // the argument to any entry that happened to exist, and the slot was
    // cleared without the work being written anywhere at all.
    for (const savedAt of [undefined, 'yesterday']) {
      upsertRecentFlame('autosave-killed', {
        ...flame,
        metadata: { ...flame.metadata, name: 'Older work, newer entry' },
      })
      safeSetItem(
        DRAFT_KEY,
        JSON.stringify({
          flame,
          ...(savedAt === undefined ? {} : { savedAt }),
          animation: { tracks, config },
          sessionId: 'autosave-killed',
        }),
      )

      takeDraftForLaunch({ native: true, search: '' })
      expect(loadRecentFlames()[0]?.flame.metadata?.name).toBe('Draft')
      expect(readDraft()).toBeUndefined()
      reset()
    }
  })

  it('does not count an entry the Library cannot read as a copy', () => {
    // Structurally an entry, but its flame fails the schema, so the Library
    // - which validates - never shows it. Comparing against it and calling
    // the work secured left that work invisible everywhere the user could
    // look for it, and took the draft slot away as well.
    safeSetItem(
      RECENTS_KEY,
      JSON.stringify([
        { id: 'autosave-killed', name: 'Hollow', savedAt: 9e12, flame: {} },
      ]),
    )
    seedDraft({ sessionId: 'autosave-killed', savedAt: 1000 })

    takeDraftForLaunch({ native: true, search: '' })
    expect(
      loadRecentFlames().map((entry) => entry.flame.metadata?.name),
    ).toEqual(['Draft'])
    expect(readDraft()).toBeUndefined()
  })

  it('keeps the slot when the write itself is refused', () => {
    // The slot is then the only copy of the work, so it stays in it and the
    // next launch offers it again.
    seedDraft({ sessionId: 'autosave-killed' })
    storageRefuses = true
    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.flame.metadata?.name).toBe('Draft')
    storageRefuses = false
    expect(readDraft()?.flame.metadata?.name).toBe('Draft')
    expect(loadRecentFlames()).toHaveLength(0)
  })

  it('rescues a draft written before the envelope carried an entry', () => {
    safeSetItem(
      DRAFT_KEY,
      JSON.stringify({
        flame,
        savedAt: Date.now(),
        animation: { tracks, config },
      }),
    )
    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.flame.metadata?.name).toBe('Draft')
    expect(loadRecentFlames()).toHaveLength(1)
    expect(loadRecentFlames()[0]?.id).toMatch(/^autosave-/)
  })
})

describe('hasSharePayload', () => {
  it('knows the three ways a link carries a flame', () => {
    expect(hasSharePayload('?s=abc')).toBe(true)
    expect(hasSharePayload('?flame=abc')).toBe(true)
    expect(hasSharePayload('?cv=abc')).toBe(true)
    expect(hasSharePayload('?benchmark=auto')).toBe(false)
    expect(hasSharePayload('')).toBe(false)
  })
})

describe('the draft a launch restored', () => {
  it('is safe from a workspace that counts itself clean', () => {
    // The chain the app walks, with the modules the app walks it with: the
    // launch (App.tsx), the editor's autosave and the pause backup wired the
    // way MainWorkspace wires them.
    //
    // This is the scenario three fix passes shipped broken. A draft carrying
    // an animation lands in the workspace, whose load boundary - taken twice
    // per hand-off, once for the flame and once for its animation - says the
    // workspace is clean. Every earlier version read that as "nothing to keep"
    // and deleted the draft on the next pause, and the work was gone from
    // memory, from storage and from Recents at once.
    seedDraft({ sessionId: 'autosave-killed' })
    const platform = fakePlatform()

    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.tracks?.length).toBe(1)

    createRoot((dispose) => {
      const [flameStore] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(restored?.flame)),
      )
      const currentTracks = restored?.tracks ?? []
      const autosave = useWorkspaceAutosave({
        flameDescriptor: flameStore,
        getTracks: () => currentTracks,
        agentDriving: () => false,
        showToast: () => undefined,
      })
      const backup = installDraftBackup({
        native: true,
        read: () => ({
          flame: unwrap(flameStore),
          tracks: currentTracks,
          config,
          sessionId: autosave.autosaveSessionId(),
        }),
        unsaved: autosave.isFlameDirty,
      })

      // Both halves of the hand-off take the load boundary.
      autosave.markLoadedBaseline()
      autosave.markLoadedBaseline()
      // A launch nobody has touched is not somebody mid-edit: dirty here is
      // what made the autosave prompt and the five-minute reminder fire on
      // every restore.
      expect(autosave.isFlameDirty()).toBe(false)

      // Any share sheet or app switch.
      platform.pause()

      const recents = loadRecentFlames()
      expect(recents.map((entry) => entry.flame.metadata?.name)).toEqual([
        'Draft',
      ])
      // One entry, the killed session's own, with the animation in it.
      expect(recents[0]?.id).toBe('autosave-killed')
      expect(recents[0]?.tracks?.[0]?.parameterPath).toBe(
        tracks[0]?.parameterPath,
      )

      backup.dispose()
      dispose()
    })
  })

  it('never writes over the newer entry the rescue declined to touch', () => {
    // THE SEQUENCE. Edit a flame; the share sheet pauses the app and the
    // draft is written under that session's entry. Come back, open another
    // flame from Library - the chokepoint flushes the newer version into
    // that same entry - touch nothing, and the OS force-stops the app.
    seedDraft({ sessionId: 'autosave-killed', savedAt: 1000 })
    upsertRecentFlame(
      'autosave-killed',
      { ...flame, metadata: { ...flame.metadata, name: 'Flushed after it' } },
      undefined,
      [],
    )

    // Relaunch. The rescue finds a newer entry there and rightly leaves it
    // alone - and used to hand that entry's id over anyway, so the workspace
    // adopted an entry nothing had written the restored flame into.
    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.flame.metadata?.name).toBe('Draft')

    createRoot((dispose) => {
      const [flameStore, setFlameStore] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(restored?.flame)),
      )
      const autosave = useWorkspaceAutosave({
        flameDescriptor: flameStore,
        getTracks: () => restored?.tracks ?? [],
        agentDriving: () => false,
        showToast: () => undefined,
      })
      autosave.markLoadedBaseline()

      // The first thing the user does with the flame they were told was
      // restored. This is the write that destroyed the other half.
      setFlameStore('metadata', 'name', 'Edited after the restore')
      autosave.flushDirtyToRecents()

      const names = loadRecentFlames().map(
        (entry) => entry.flame.metadata?.name,
      )
      expect(names).toContain('Flushed after it')
      expect(names).toContain('Edited after the restore')
      dispose()
    })
  })
})
