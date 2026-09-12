import { createRoot, createSignal } from 'solid-js'
import { createStore, unwrap } from 'solid-js/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFlameXml } from '@/flame/flameXml'
import { useWorkspaceAutosave } from '@/hooks/useWorkspaceAutosave'
import { clearRecentFlames, deleteRecentFlame, loadRecentFlames, loadRecentFlamesForRewrite, MAX_RECENT_FLAMES, upsertRecentFlame, } from '@/utils/recentFlames'
import { safeSetItem } from '@/utils/storage'
import { defaultConfig } from '@/utils/timeline'
import { clearDraft, clearDraftIfSaved, DRAFT_KEY, hasSharePayload, installDraftBackup, readDraft, saveDraft, takeDraftForLaunch, } from './draft'
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

/** Every flame the schema is asked to validate, counted. The rescue runs
 *  before first paint on a native cold start, and a pass over a full 150-entry
 *  list costs about 90ms by that module's own measurement, so what it is
 *  allowed to validate is a property worth pinning. The real validator still
 *  does the work - this only counts the calls. */
const validations = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/flame/schema/flameSchema', async (importOriginal) => {
  // Declared as taking `unknown`, so `--fix` cannot decide the cast is
  // unnecessary and delete it: `importOriginal` is untyped here.
  const exportsOf = (module: unknown): Record<string, unknown> =>
    module as Record<string, unknown>
  const actual = exportsOf(await importOriginal())
  const validate = actual.tryValidateFlame as (value: unknown) => unknown
  return {
    ...actual,
    tryValidateFlame: (value: unknown) => {
      validations.count++
      return validate(value)
    },
  }
})

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

/** A Recents list with no room left in it. */
const seedFullRecents = (ids: string[] = []) => {
  const entries = Array.from({ length: MAX_RECENT_FLAMES }, (_, index) => ({
    id: ids[index] ?? `kept-${index}`,
    name: `Kept ${index}`,
    savedAt: 1000 + index,
    flame,
  }))
  safeSetItem(RECENTS_KEY, JSON.stringify(entries))
}

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

  it('counts a change to only the timeline as work, as the app must', () => {
    // The app cannot hand the unsaved flag in: it is the editor's own dirty
    // flag, computed from the snapshot in useWorkspaceAutosave. Until the
    // timeline was part of that snapshot, changing the frame rate, the end
    // frame or the loop mode and nothing else left the app believing there
    // was nothing to keep - no draft on pause, no flush at a load boundary,
    // and the change died with the process.
    const platform = fakePlatform()
    createRoot((dispose) => {
      const [flameStore] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(flame)),
      )
      const [current, setCurrent] = createSignal<TimelineConfig>(config)
      const autosave = useWorkspaceAutosave({
        flameDescriptor: flameStore,
        getTracks: () => tracks,
        getConfig: current,
        agentDriving: () => false,
        showToast: () => undefined,
      })
      const backup = installDraftBackup({
        native: true,
        read: () => ({
          flame: unwrap(flameStore),
          tracks,
          config: current(),
          sessionId: autosave.autosaveSessionId(),
        }),
        unsaved: autosave.isFlameDirty,
      })
      autosave.markLoadedBaseline()
      expect(autosave.isFlameDirty()).toBe(false)

      // The only thing the user touches.
      setCurrent({ ...config, fps: 24 })
      expect(autosave.isFlameDirty()).toBe(true)

      platform.pause()
      expect(readDraft()?.config?.fps).toBe(24)

      // And the same change reaches Recents, where the work outlives the
      // draft slot.
      autosave.flushDirtyToRecents()
      expect(loadRecentFlames()[0]?.config?.fps).toBe(24)

      backup.dispose()
      dispose()
    })
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

  it('draws the line between the two halves at the millisecond', () => {
    // The entry and the draft are two halves of one session's work. Newer or
    // level, the entry stands; older by a millisecond, the draft replaces it.
    const seedEntry = (savedAt: number) => {
      safeSetItem(
        RECENTS_KEY,
        JSON.stringify([
          {
            id: 'autosave-killed',
            name: 'Entry',
            savedAt,
            flame: { ...flame, metadata: { ...flame.metadata, name: 'Entry' } },
          },
        ]),
      )
    }
    for (const [entrySavedAt, winner] of [
      [999, 'Draft'],
      [1000, 'Entry'],
      [1001, 'Entry'],
    ] as const) {
      seedEntry(entrySavedAt)
      seedDraft({ sessionId: 'autosave-killed', savedAt: 1000 })
      takeDraftForLaunch({ native: true, search: '' })
      expect(loadRecentFlames()[0]?.flame.metadata?.name).toBe(winner)
      expect(readDraft()).toBeUndefined()
      reset()
    }
  })

  it('shelves the work rather than opening it over a link', () => {
    // Restoring over the link would replace what it was opened for, and
    // dropping the draft would lose a friend's tap. Half of each - write the
    // entry, keep the slot - was what it did, and the slot then held a copy
    // of work that was already on the shelf: the first pause on the flame
    // the link opened overwrote it, and deleting the entry in Library got it
    // written back on the next plain launch. So the work goes to Recents and
    // the slot is spent, exactly as on a plain launch; only the opening is
    // declined.
    seedDraft()
    const outcome = takeDraftForLaunch({ native: true, search: '?s=abc' })
    expect(outcome?.shelvedOnly).toBe(true)
    expect(outcome?.entry).toBeUndefined()
    expect(loadRecentFlames()[0]?.flame.metadata?.name).toBe('Draft')
    expect(readDraft()).toBeUndefined()
  })

  it('does not write an entry back after the user deletes it', () => {
    // THE SEQUENCE. Tap a friend's link, see the flame from last time appear
    // in Library, delete it - and the next plain launch put it back, because
    // the slot still held it.
    seedDraft({ sessionId: 'autosave-killed' })
    takeDraftForLaunch({ native: true, search: '?s=abc' })
    deleteRecentFlame('autosave-killed')

    expect(takeDraftForLaunch({ native: true, search: '' })).toBeUndefined()
    expect(loadRecentFlames()).toHaveLength(0)
  })

  it('keeps the slot when a link launch cannot shelve the work', () => {
    // Nothing else holds it, so the slot is still the only copy and the next
    // plain launch offers it again.
    seedFullRecents()
    seedDraft({ sessionId: 'autosave-killed' })
    expect(
      takeDraftForLaunch({ native: true, search: '?s=abc' }),
    ).toBeUndefined()
    expect(readDraft()?.flame.metadata?.name).toBe('Draft')
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
    expect(restored?.unsecured).toBe('refused')
    storageRefuses = false
    expect(readDraft()?.flame.metadata?.name).toBe('Draft')
    expect(loadRecentFlames()).toHaveLength(0)
  })

  it('will not evict a saved flame to make room for crash debris', () => {
    // Save for Later stops and asks before overwriting the oldest entry. A
    // rescue nobody asked for must not do quietly what the user is asked
    // about, so nothing is evicted, the work stays in the slot, and the
    // user's own next save is what decides.
    seedFullRecents()
    seedDraft({ sessionId: 'autosave-killed' })

    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.flame.metadata?.name).toBe('Draft')

    // The oldest kept flame is still there.
    const recents = loadRecentFlames()
    expect(recents).toHaveLength(MAX_RECENT_FLAMES)
    expect(recents.some((entry) => entry.id === 'kept-149')).toBe(true)
    expect(recents.some((entry) => entry.id === 'autosave-killed')).toBe(false)
    // Offered again next launch, rather than gone.
    expect(readDraft()?.flame.metadata?.name).toBe('Draft')
    // And the notice will not claim the flame is saved.
    expect(restored?.unsecured).toBe('full')
  })

  it('still writes into its own entry when the list is full', () => {
    // Replacing an entry that is already there grows nothing and evicts
    // nobody: it is the same session's own work.
    seedFullRecents(['autosave-killed'])
    seedDraft({ sessionId: 'autosave-killed', savedAt: 9e12 })

    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.unsecured).toBeUndefined()
    const recents = loadRecentFlames()
    expect(recents).toHaveLength(MAX_RECENT_FLAMES)
    expect(recents[0]?.id).toBe('autosave-killed')
    expect(recents[0]?.flame.metadata?.name).toBe('Draft')
    expect(readDraft()).toBeUndefined()
  })

  it('validates the entry it cares about, not the whole shelf', () => {
    // The rescue ran two full schema passes over the stored list before
    // first paint, on every native cold start that had a draft. What it
    // needs is one entry: the one its killed session owned, read the way the
    // Library reads it.
    seedFullRecents(['autosave-killed'])
    seedDraft({ sessionId: 'autosave-killed', savedAt: 9e12 })

    validations.count = 0
    const restored = takeDraftForLaunch({ native: true, search: '' })

    // The draft's own flame, the entry before the write, the same entry
    // after it. Nothing that scales with the length of the list.
    expect(validations.count).toBeLessThanOrEqual(3)
    expect(restored?.flame.metadata?.name).toBe('Draft')
    expect(loadRecentFlames()[0]?.flame.metadata?.name).toBe('Draft')
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

describe('the slot a save empties', () => {
  it('goes when the work in it is the work that was just saved', () => {
    // At the cap the rescue writes nothing and keeps the slot, so the launch
    // after it offers the same flame again - and the notice telling the user
    // to save it for later came back every launch, with nothing the save
    // could do about it. Their own save is what ends it.
    seedDraft({ sessionId: 'autosave-killed' })
    clearDraftIfSaved({ flame, tracks, config })
    expect(readDraft()).toBeUndefined()
  })

  it('stays when the slot holds something else', () => {
    // The slot holds one piece of work and the workspace may be holding
    // another - the user restored a draft and then opened a different flame.
    // Emptying it on any successful save would delete unsaved work that has
    // never been anywhere else.
    seedDraft({ sessionId: 'autosave-killed' })
    clearDraftIfSaved({
      flame: {
        ...flame,
        metadata: { ...flame.metadata, name: 'Something else' },
      },
      tracks,
      config,
    })
    expect(readDraft()?.flame.metadata?.name).toBe('Draft')

    // Same flame, a timeline the slot does not have: still not the same work.
    clearDraftIfSaved({ flame, tracks, config: { ...config, fps: 24 } })
    expect(readDraft()?.flame.metadata?.name).toBe('Draft')
  })

  it('is harmless with no slot at all', () => {
    clearDraftIfSaved({ flame, tracks, config })
    expect(readDraft()).toBeUndefined()
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
  it('survives the hand-off the app actually makes', () => {
    // The chain the app walks, with the modules the app walks it with: the
    // launch (App.tsx), the editor's autosave and the pause backup wired the
    // way MainWorkspace wires them.
    //
    // One hand-off takes the load boundary TWICE, and not at the same
    // moment: once when the flame lands, with the timeline still at the
    // reset's defaults, and once when the animation arrives in the effect
    // that consumes it. The window between them is where three fix passes'
    // bugs lived, and a test that takes both baselines together never enters
    // it.
    seedDraft({ sessionId: 'autosave-killed' })
    const platform = fakePlatform()

    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.tracks?.length).toBe(1)
    // The rescue got there first: the work is on the shelf, timeline and all.
    const rescued = loadRecentFlames()
    expect(rescued.map((entry) => entry.id)).toEqual(['autosave-killed'])
    expect(rescued[0]?.tracks?.[0]?.parameterPath).toBe(
      tracks[0]?.parameterPath,
    )
    expect(rescued[0]?.config?.endFrame).toBe(300)

    createRoot((dispose) => {
      const [flameStore] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(restored?.flame)),
      )
      // What the hand-off's reset leaves behind: no tracks, and the default
      // timeline, until the animation effect runs.
      let liveTracks: TimelineTrack[] = []
      let liveConfig: TimelineConfig = defaultConfig()
      const autosave = useWorkspaceAutosave({
        flameDescriptor: flameStore,
        getTracks: () => liveTracks,
        getConfig: () => liveConfig,
        agentDriving: () => false,
        showToast: () => undefined,
      })
      const backup = installDraftBackup({
        native: true,
        read: () => ({
          flame: unwrap(flameStore),
          tracks: liveTracks,
          config: liveConfig,
          sessionId: autosave.autosaveSessionId(),
        }),
        unsaved: autosave.isFlameDirty,
      })

      // FIRST boundary: the flame is in, its animation is not.
      autosave.markLoadedBaseline()
      expect(autosave.isFlameDirty()).toBe(false)

      // The animation lands in its own effect. Until the second boundary the
      // workspace holds something its baseline does not.
      liveTracks = restored?.tracks ?? []
      liveConfig = restored?.config ?? defaultConfig()
      expect(autosave.isFlameDirty()).toBe(true)

      // A pause in that window - a share sheet, an app switch - keeps a copy
      // of what is in front of the user rather than dropping one.
      platform.pause()
      expect(readDraft()?.config?.endFrame).toBe(300)
      expect(readDraft()?.tracks?.[0]?.parameterPath).toBe(
        tracks[0]?.parameterPath,
      )

      // SECOND boundary: a launch nobody has touched is not somebody
      // mid-edit, which is what made the autosave prompt and the five-minute
      // reminder fire on every restore.
      autosave.markLoadedBaseline()
      expect(autosave.isFlameDirty()).toBe(false)

      // And the rescued entry came through all of it untouched.
      const recents = loadRecentFlames()
      expect(recents.map((entry) => entry.flame.metadata?.name)).toEqual([
        'Draft',
      ])
      expect(recents[0]?.id).toBe('autosave-killed')
      expect(recents[0]?.tracks?.[0]?.parameterPath).toBe(
        tracks[0]?.parameterPath,
      )
      expect(recents[0]?.config?.endFrame).toBe(300)

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
    // adopted an entry nothing had written the restored flame into. It hands
    // over an entry only when it wrote one, so there is nothing to take over
    // here even though the id exists.
    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.flame.metadata?.name).toBe('Draft')
    expect(restored?.entry).toBeUndefined()

    createRoot((dispose) => {
      const [flameStore, setFlameStore] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(restored?.flame)),
      )
      const autosave = useWorkspaceAutosave({
        flameDescriptor: flameStore,
        getTracks: () => restored?.tracks ?? [],
        getConfig: () => restored?.config,
        agentDriving: () => false,
        showToast: () => undefined,
      })
      autosave.markLoadedBaseline()
      autosave.claimRestoredEntry(restored?.entry)

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

  it('takes over the entry the rescue wrote instead of adding a second', () => {
    // ONE RESTORED FLAME, ONE ENTRY. The workspace mints an id of its own,
    // which is what stopped it overwriting an entry the rescue had decided
    // not to write to - and left the rescue's entry and the workspace's
    // entry holding the same piece of work, so one crash cost two of the 150
    // places. The entry is taken over only while it still holds exactly what
    // the rescue put there, which is checked at the moment of the write.
    seedDraft({ sessionId: 'autosave-killed' })
    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.entry?.id).toBe('autosave-killed')

    createRoot((dispose) => {
      const [flameStore, setFlameStore] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(restored?.flame)),
      )
      const autosave = useWorkspaceAutosave({
        flameDescriptor: flameStore,
        getTracks: () => restored?.tracks ?? [],
        getConfig: () => restored?.config,
        agentDriving: () => false,
        showToast: () => undefined,
      })
      autosave.markLoadedBaseline()
      autosave.claimRestoredEntry(restored?.entry)

      setFlameStore('metadata', 'name', 'Edited after the restore')
      autosave.flushDirtyToRecents()

      const recents = loadRecentFlames()
      expect(recents).toHaveLength(1)
      expect(recents[0]?.id).toBe('autosave-killed')
      expect(recents[0]?.flame.metadata?.name).toBe('Edited after the restore')
      dispose()
    })
  })

  it('still costs one place when the crash comes before any flush', () => {
    // Restore, type one character, and the OS force-stops the app before
    // anything has flushed: the only write is the pause backup, and the entry
    // it names is the one the next launch rescues into. Taking the entry over
    // at the first write alone left that draft carrying a fresh id, so the
    // launch after it filed the same work a second time.
    seedDraft({ sessionId: 'autosave-killed' })
    const platform = fakePlatform()
    const restored = takeDraftForLaunch({ native: true, search: '' })

    createRoot((dispose) => {
      const [flameStore, setFlameStore] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(restored?.flame)),
      )
      const autosave = useWorkspaceAutosave({
        flameDescriptor: flameStore,
        getTracks: () => restored?.tracks ?? [],
        getConfig: () => restored?.config,
        agentDriving: () => false,
        showToast: () => undefined,
      })
      const backup = installDraftBackup({
        native: true,
        read: () => ({
          flame: unwrap(flameStore),
          tracks: restored?.tracks ?? [],
          config: restored?.config ?? defaultConfig(),
          sessionId: autosave.autosaveSessionId(),
        }),
        unsaved: autosave.isFlameDirty,
      })
      autosave.markLoadedBaseline()
      autosave.claimRestoredEntry(restored?.entry)

      setFlameStore('metadata', 'name', 'Edited after the restore')
      platform.pause()

      backup.dispose()
      dispose()
    })

    // The launch after the force-stop.
    takeDraftForLaunch({ native: true, search: '' })
    const recents = loadRecentFlames()
    expect(recents).toHaveLength(1)
    expect(recents[0]?.flame.metadata?.name).toBe('Edited after the restore')
  })

  it('leaves that entry alone once something else has written to it', () => {
    // The id is not proof. Between the rescue and the first flush another
    // path can write to the same entry, and taking it over then is the
    // overwrite that cost a user their newer flame.
    seedDraft({ sessionId: 'autosave-killed' })
    const restored = takeDraftForLaunch({ native: true, search: '' })
    upsertRecentFlame('autosave-killed', {
      ...flame,
      metadata: { ...flame.metadata, name: 'Written by something else' },
    })

    createRoot((dispose) => {
      const [flameStore, setFlameStore] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(restored?.flame)),
      )
      const autosave = useWorkspaceAutosave({
        flameDescriptor: flameStore,
        getTracks: () => restored?.tracks ?? [],
        getConfig: () => restored?.config,
        agentDriving: () => false,
        showToast: () => undefined,
      })
      autosave.markLoadedBaseline()
      autosave.claimRestoredEntry(restored?.entry)

      setFlameStore('metadata', 'name', 'Edited after the restore')
      autosave.flushDirtyToRecents()

      const names = loadRecentFlames().map(
        (entry) => entry.flame.metadata?.name,
      )
      expect(names).toContain('Written by something else')
      expect(names).toContain('Edited after the restore')
      dispose()
    })
  })

  it('never pushes out a kept flame, whichever write is doing it', () => {
    // The rescue refuses to evict at the cap and keeps the slot - and then
    // the restored workspace's own first flush went through the upsert,
    // which dropped the oldest entry to make room. Recents full, crash
    // restore, type one character, and a flame the user chose to keep was
    // gone with nobody asked. The rule holds at every writer, so the flush
    // declines too, and says so rather than failing silently.
    seedFullRecents()
    seedDraft({ sessionId: 'autosave-killed' })
    const restored = takeDraftForLaunch({ native: true, search: '' })
    expect(restored?.unsecured).toBe('full')

    const toasts: string[] = []
    createRoot((dispose) => {
      const [flameStore, setFlameStore] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(restored?.flame)),
      )
      const autosave = useWorkspaceAutosave({
        flameDescriptor: flameStore,
        getTracks: () => restored?.tracks ?? [],
        getConfig: () => restored?.config,
        agentDriving: () => false,
        showToast: (message) => toasts.push(message),
      })
      // Nothing to take over: the rescue wrote nothing, so this workspace
      // opens an entry of its own - which is the write that used to evict.
      autosave.markLoadedBaseline()
      expect(restored?.entry).toBeUndefined()

      setFlameStore('metadata', 'name', 'Edited after the restore')
      autosave.flushDirtyToRecents()

      const kept = loadRecentFlamesForRewrite()
      expect(kept).toHaveLength(MAX_RECENT_FLAMES)
      expect(kept.some((entry) => entry.id === 'kept-149')).toBe(true)
      expect(
        kept.some(
          (entry) => entry.flame.metadata?.name === 'Edited after the restore',
        ),
      ).toBe(false)
      // Silence would be the app quietly not saving. The user is told, once,
      // and the work is still in the slot for the next launch.
      expect(toasts.join(' ')).toContain('Recents is full')
      expect(readDraft()?.flame.metadata?.name).toBe('Draft')
      dispose()
    })
  })
})
