import { describe, expect, it, vi } from 'vitest'
import { parseFlameXml } from '@/flame/flameXml'
import { safeSetItem } from '@/utils/storage'
import { clearDraft, DRAFT_KEY, draftAction, hasSharePayload, markDraftBaseline, readDraft, saveDraft, } from './draft'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { TimelineTrack } from '@/utils/timeline'

// localStorage is not usable in this runtime (the same reason
// TouchSurface.test.tsx mocks this module), so the draft round-trips through
// an in-memory store. What is under test is the envelope, not the browser's.
const store = new Map<string, string>()
vi.mock('@/utils/storage', () => ({
  safeGetItem: (key: string) => store.get(key) ?? null,
  safeSetItem: (key: string, value: string) => {
    store.set(key, value)
    return true
  },
  safeRemoveItem: (key: string) => {
    store.delete(key)
  },
}))

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

describe('the background draft', () => {
  it('comes back with its flame and its tracks', () => {
    saveDraft(flame, tracks)
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
    clearDraft()
  })

  it('saves a flame with no animation', () => {
    saveDraft(flame)
    const draft = readDraft()
    expect(draft?.flame.metadata?.name).toBe('Draft')
    expect(draft?.tracks).toBeUndefined()
    clearDraft()
  })

  it('reads nothing once it is cleared', () => {
    saveDraft(flame)
    clearDraft()
    expect(readDraft()).toBeUndefined()
  })

  it('is not a crash when the value is corrupt', () => {
    safeSetItem(DRAFT_KEY, '{"flame": nonsense')
    expect(readDraft()).toBeUndefined()
    safeSetItem(DRAFT_KEY, '{"hello":"world"}')
    expect(readDraft()).toBeUndefined()
    clearDraft()
  })

  it('writes nothing when nothing has changed since the baseline', () => {
    // Android fires pause for every share sheet and permission dialog, so an
    // untouched flame would otherwise become a draft on the first background
    // and be offered back on every cold start after it.
    markDraftBaseline(flame, tracks)
    saveDraft(flame, tracks)
    expect(readDraft()).toBeUndefined()
  })

  it('writes an edited flame, and clears once it is back at the baseline', () => {
    markDraftBaseline(flame)
    const edited: FlameDescriptor = {
      ...flame,
      metadata: { ...flame.metadata, name: 'Edited' },
    }
    saveDraft(edited)
    expect(readDraft()?.flame.metadata?.name).toBe('Edited')

    // Undone back to where it started: nothing left to restore, so the stale
    // draft goes rather than outliving the work it came from.
    saveDraft(flame)
    expect(readDraft()).toBeUndefined()
  })

  it('carries the timeline the animation was authored at', () => {
    // Without the config a restored animation came back at the hand-off's
    // reset - 30fps, 90 frames - so keyframes past frame 90 were unreachable
    // and the motion ran at half speed, while the same flame through `?s=`
    // returned intact.
    markDraftBaseline(flame)
    saveDraft(flame, tracks, {
      fps: 60,
      timeScale: 2,
      startFrame: 0,
      endFrame: 300,
      loop: false,
      autoFps: false,
      loopMode: 'seamless',
    })
    const draft = readDraft()
    expect(draft?.config?.fps).toBe(60)
    expect(draft?.config?.endFrame).toBe(300)
    expect(draft?.config?.timeScale).toBe(2)
    expect(draft?.config?.loop).toBe(false)
    expect(draft?.config?.loopMode).toBe('seamless')
    clearDraft()
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
    clearDraft()
  })
})

describe('what a launch does with the draft', () => {
  it('restores under the welcome screen, which is not a first run', () => {
    // The welcome screen shows on every launch until the user ticks "Don't
    // show again", and the workspace is mounted behind it, so there is
    // somewhere for the flame to land. Skipping the restore there lost the
    // session on the one path that always runs - and because the skip
    // returned before clearing, the draft was left to be restored over some
    // later, unrelated session. The welcome screen is deliberately not an
    // input here.
    expect(draftAction({ native: true, search: '' })).toBe('restore')
  })

  it('drops the draft when the link carries its own flame', () => {
    expect(draftAction({ native: true, search: '?s=abc' })).toBe('clear')
    expect(draftAction({ native: true, search: '?cv=abc' })).toBe('clear')
  })

  it('does nothing on the web, where nothing writes one', () => {
    expect(draftAction({ native: false, search: '' })).toBe('ignore')
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
