import { createRoot } from 'solid-js'
import { createStore } from 'solid-js/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFlameXml } from '@/flame/flameXml'
import { setAutosaveRecents, setSaveReminderDismissed, } from '@/utils/autosaveSettings'
import { clearRecentFlames, loadRecentFlames, loadRecentFlamesForRewrite, MAX_RECENT_FLAMES, } from '@/utils/recentFlames'
import { useWorkspaceAutosave } from './useWorkspaceAutosave'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

// Same reason as draft.test.ts: localStorage is not usable in this runtime, so
// Recents round-trips through an in-memory store. `storageRefuses` is the
// quota / private window / locked-down WebView case, which is the one this
// file is mostly about.
const store = new Map<string, string>()
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

const parsed = parseFlameXml(`<?xml version="1.0" encoding="UTF-8"?>
<flame name="Open" version="Apophysis 7X" size="800 600"
       center="0 0" scale="200" oversample="1" filter="0.5"
       quality="100" background="0 0 0" brightness="4" gamma="2.2">
  <xform weight="1" color="0" linear="1" coefs="1 0 0 1 0 0"/>
</flame>`)
const flame: FlameDescriptor = {
  ...parsed,
  metadata: { ...parsed.metadata, name: 'Open' },
}

/** A shelf with no room left on it, written structurally so the cap is
 *  reached without 150 schema passes. */
const fillRecents = () => {
  store.set(
    'chaos-master-recent-flames',
    JSON.stringify(
      Array.from({ length: MAX_RECENT_FLAMES }, (_, index) => ({
        id: `kept-${index}`,
        name: `Kept ${index}`,
        savedAt: 1000 + index,
        flame,
      })),
    ),
  )
}

const declineOverwrite = () => Promise.resolve(false)
const keepUnsaved = () => Promise.resolve(false)

/**
 * A workspace wired the way MainWorkspace wires one, with the toast store
 * under the test's control.
 *
 * `muted` is what the store does while an Arcade pilot drives: it shows
 * nothing and returns -1 (contexts/ToastContext.tsx). Toasts raised in that
 * state are the ones the one-per-run notices used to be spent on.
 */
const workspace = (
  options: {
    muted?: () => boolean
    confirmOverwriteOldest?: () => Promise<boolean>
    confirmDiscardUnsaved?: () => Promise<boolean>
  } = {},
) => {
  const toasts: string[] = []
  const [open, setOpen] = createStore<FlameDescriptor>(
    JSON.parse(JSON.stringify(flame)),
  )
  let nextToastId = 1
  const autosave = useWorkspaceAutosave({
    flameDescriptor: open,
    getTracks: () => [],
    getConfig: () => undefined,
    agentDriving: () => false,
    showToast: (message) => {
      if (options.muted?.()) return -1
      toasts.push(message)
      return nextToastId++
    },
    confirmOverwriteOldest: options.confirmOverwriteOldest ?? declineOverwrite,
    confirmDiscardUnsaved: options.confirmDiscardUnsaved ?? keepUnsaved,
  })
  return { autosave, setOpen, toasts }
}

afterEach(() => {
  storageRefuses = false
  clearRecentFlames()
  store.clear()
  setAutosaveRecents('unset')
  setSaveReminderDismissed(false)
  vi.useRealTimers()
})

describe('what an autosave says when it did not land', () => {
  it('names a refusal rather than reporting nothing at all', () => {
    // A full shelf was the only outcome worth mentioning, so a refusal - a
    // quota, a private window, a locked-down WebView - looked exactly like a
    // save. The user could answer "yes, auto-save my flames", see no
    // complaint, and edit for hours with every write discarded.
    createRoot((dispose) => {
      const { autosave, setOpen, toasts } = workspace()
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Unsaved work')
      storageRefuses = true

      autosave.autosaveNow()

      expect(toasts.join(' ')).toContain('Auto-saving is not working')
      // And it does not claim the flame is somewhere it is not.
      expect(loadRecentFlames()).toHaveLength(0)
      dispose()
    })
  })

  it('says a refusal once, not every interval', () => {
    createRoot((dispose) => {
      const { autosave, setOpen, toasts } = workspace()
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Unsaved work')
      storageRefuses = true

      autosave.autosaveNow()
      autosave.autosaveNow()

      expect(toasts).toHaveLength(1)
      dispose()
    })
  })

  it('does not spend its one notice on a toast nobody saw', () => {
    // The store is muted while an Arcade pilot drives and shows nothing,
    // returning -1. The flag used to be set before the call, so a lesson
    // running at the wrong moment swallowed the only notice the run gets and
    // the shelf stayed silently full for the rest of the session.
    fillRecents()
    let muted = true
    createRoot((dispose) => {
      const { autosave, setOpen, toasts } = workspace({ muted: () => muted })
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Unsaved work')

      autosave.autosaveNow()
      expect(toasts).toHaveLength(0)

      muted = false
      autosave.autosaveNow()
      expect(toasts.join(' ')).toContain('Recents is full')
      dispose()
    })
  })

  it('does not spend the refusal notice on a muted toast either', () => {
    let muted = true
    createRoot((dispose) => {
      const { autosave, setOpen, toasts } = workspace({ muted: () => muted })
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Unsaved work')
      storageRefuses = true

      autosave.autosaveNow()
      expect(toasts).toHaveLength(0)

      muted = false
      autosave.autosaveNow()
      expect(toasts.join(' ')).toContain('Auto-saving is not working')
      dispose()
    })
  })
})

describe('the Recents entry a session writes to', () => {
  it('is a new one at every load boundary, same flame or not', () => {
    // THE SEQUENCE. Open F, edit it, then open F again from Library - the
    // natural "start over from the original". The flush at the replacement
    // writes the edits into this session's entry; the boundary used to keep
    // that entry because the incoming descriptor was identical, and the next
    // autosave of the fresh copy replaced them. The entry even keeps its
    // name, so nothing looks wrong.
    createRoot((dispose) => {
      const { autosave, setOpen } = workspace()
      autosave.markLoadedBaseline()

      setOpen('metadata', 'name', 'An hour of work')
      expect(autosave.flushDirtyToRecents()).toBe('saved')

      // Re-opening the same flame: the descriptor the boundary sees is the
      // one it saw last time.
      setOpen('metadata', 'name', 'Open')
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Second session')
      expect(autosave.flushDirtyToRecents()).toBe('saved')

      const names = loadRecentFlames().map(
        (entry) => entry.flame.metadata?.name,
      )
      expect(names).toContain('An hour of work')
      expect(names).toContain('Second session')
      dispose()
    })
  })

  it('is a new one for a second New Flame, which loads the same starter', () => {
    // The same hole reached without Library: New Flame twice produces two
    // identical descriptors, so the second boundary kept the entry the first
    // session's work had just been flushed into.
    createRoot((dispose) => {
      const { autosave, setOpen } = workspace()
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Edited the starter')
      autosave.flushDirtyToRecents()

      setOpen('metadata', 'name', 'Open')
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Edited it again')
      autosave.flushDirtyToRecents()

      expect(loadRecentFlamesForRewrite()).toHaveLength(2)
      dispose()
    })
  })
})

describe('a restored draft Recents could not take', () => {
  it('stays unsaved, so every writer still catches it', () => {
    // The launch put this flame back in front of the user and could NOT put
    // it in Recents. Baselining it marked the only live copy clean, and the
    // interval autosave, the pagehide flush and the flush at the next
    // replacement all skip a clean document - so the single draft slot was
    // the whole of the safety net, and the next pause on another document
    // took it.
    createRoot((dispose) => {
      const { autosave } = workspace()
      autosave.markLoadedBaseline({ unsecured: true })

      expect(autosave.isFlameDirty()).toBe(true)
      expect(autosave.flushDirtyToRecents()).toBe('saved')
      expect(loadRecentFlames()).toHaveLength(1)
      dispose()
    })
  })

  it('stops counting as unsaved once it reaches Recents', () => {
    createRoot((dispose) => {
      const { autosave } = workspace()
      autosave.markLoadedBaseline({ unsecured: true })
      autosave.autosaveNow()

      expect(autosave.isFlameDirty()).toBe(false)
      dispose()
    })
  })

  it('is still unsaved after the second half of the hand-off lands', () => {
    // One hand-off crosses the boundary twice - the flame in one effect, its
    // animation in another - and only the first half knows the rescue failed.
    // A second boundary that re-baselined blindly put the bug straight back.
    createRoot((dispose) => {
      const { autosave } = workspace()
      autosave.markLoadedBaseline({ unsecured: true })
      autosave.markLoadedBaseline()

      expect(autosave.isFlameDirty()).toBe(true)
      dispose()
    })
  })

  it('is not treated as unsaved once a different document is loaded', () => {
    createRoot((dispose) => {
      const { autosave, setOpen } = workspace()
      autosave.markLoadedBaseline({ unsecured: true })
      setOpen('metadata', 'name', 'Something else entirely')
      autosave.markLoadedBaseline()

      expect(autosave.isFlameDirty()).toBe(false)
      dispose()
    })
  })

  it('does not ask to auto-save a launch nobody has touched', () => {
    // Dirty and untouched are different questions, and this is the one place
    // they come apart. Keyed on dirty alone, "auto-save your flames?" and the
    // five-minute "enjoying this flame?" fired on a restore the user had not
    // so much as looked at.
    vi.useFakeTimers()
    createRoot((dispose) => {
      const { autosave, setOpen, toasts } = workspace()
      autosave.markLoadedBaseline({ unsecured: true })

      vi.advanceTimersByTime(6 * 60_000)
      expect(toasts).toEqual([])

      // One real edit and the prompt is owed.
      setOpen('metadata', 'name', 'Now they have touched it')
      vi.advanceTimersByTime(30_000)
      expect(toasts.join(' ')).toContain('Auto-save your flames')
      dispose()
    })
  })
})

describe('a replacement the open flame could not be saved for', () => {
  it('stops and asks when storage refused the flush', () => {
    // `refused` fell through as if the write had landed, so the replacement
    // destroyed the outgoing flame and its keyframe tracks with nothing said
    // at all. Undo brings a flame back; it does not bring tracks back.
    storageRefuses = true
    let asked = 0
    return createRoot(async (dispose) => {
      const { autosave, setOpen } = workspace({
        confirmDiscardUnsaved: () => {
          asked += 1
          return Promise.resolve(false)
        },
      })
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Unsaved work')

      expect(await autosave.prepareDocumentReplacement()).toBe(false)
      expect(asked).toBe(1)
      // Still on screen, still unsaved, still the user's to export or share.
      expect(autosave.isFlameDirty()).toBe(true)
      dispose()
    })
  })

  it('names what the answer did, so the tap is not a no-op', () => {
    storageRefuses = true
    return createRoot(async (dispose) => {
      const { autosave, setOpen, toasts } = workspace()
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Unsaved work')

      await autosave.prepareDocumentReplacement()

      expect(toasts.join(' ')).toContain('Kept the open flame')
      dispose()
    })
  })

  it('goes ahead only on the user saying so', () => {
    storageRefuses = true
    return createRoot(async (dispose) => {
      const { autosave, setOpen } = workspace({
        confirmDiscardUnsaved: () => Promise.resolve(true),
      })
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Unsaved work')

      expect(await autosave.prepareDocumentReplacement()).toBe(true)
      // The answer settles it for the chokepoint too, which flushes again and
      // would otherwise refuse the replacement it was just given permission
      // for (lib/documentLoad.ts).
      expect(autosave.flushDirtyToRecents()).toBe('clean')
      dispose()
    })
  })

  it('asks the refusal question when a yes at the cap still does not land', () => {
    // They agreed to evict the oldest kept flame and the write failed anyway,
    // which is storage refusing rather than the shelf being full. Going ahead
    // regardless spent their oldest flame AND lost the open one.
    fillRecents()
    let askedDiscard = 0
    return createRoot(async (dispose) => {
      const { autosave, setOpen } = workspace({
        confirmOverwriteOldest: () => {
          storageRefuses = true
          return Promise.resolve(true)
        },
        confirmDiscardUnsaved: () => {
          askedDiscard += 1
          return Promise.resolve(false)
        },
      })
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Unsaved work')

      expect(await autosave.prepareDocumentReplacement()).toBe(false)
      expect(askedDiscard).toBe(1)
      dispose()
    })
  })
})
