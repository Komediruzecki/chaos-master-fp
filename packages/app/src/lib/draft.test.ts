import { describe, expect, it, vi } from 'vitest'
import { parseFlameXml } from '@/flame/flameXml'
import { safeSetItem } from '@/utils/storage'
import { clearDraft, DRAFT_KEY, hasSharePayload, readDraft, saveDraft, } from './draft'
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
