// Pins what a finished image export files in Recents: the authored flame,
// with its timeline and the audio wiring it was exported under, the way the
// autosave, Save for Later and the pause save keep a flame.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { examples } from '@/flame/examples'
import { deepClone } from '@/utils/clone'
import { clearRecentFlames, loadRecentFlames } from '@/utils/recentFlames'
import { defaultConfig } from '@/utils/timeline'
import { saveImageJobToRecents } from './ExportJobHost'
import type { AudioMapping } from '@/flame/schema/audioWiring'
import type { ImageJobSpec } from '@/utils/exportJobs'

const wiring: AudioMapping = {
  preset: 'custom',
  mappings: [
    {
      audioFeature: 'mid',
      target: { kind: 'renderSetting', param: 'exposure' },
      sensitivity: 0.4,
      range: [0.8, 1.4],
    },
  ],
}

function job(audio: AudioMapping | undefined): ImageJobSpec {
  const authored = deepClone(examples.example1)
  const rendered = deepClone(authored)
  rendered.renderSettings.exposure = 7
  return {
    name: 'flame',
    flame: rendered,
    authoredFlame: authored,
    quality: 1,
    dimensions: { width: 64, height: 64 },
    palette: undefined,
    blendFlame: undefined,
    blendWeight: 0,
    embedFlame: true,
    embedAnimation: false,
    condenseHidden: false,
    tracks: [],
    config: defaultConfig(),
    audio,
    session: undefined,
  }
}

// The runner's own localStorage is not writable; back it with a plain map.
const stored = new Map<string, string>()
const memoryStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => {
    stored.set(key, value)
  },
  removeItem: (key: string) => {
    stored.delete(key)
  },
}

describe('an image export filed in Recents', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage)
    clearRecentFlames()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the audio wiring it was exported under', () => {
    expect(saveImageJobToRecents(job(wiring))).toBe('saved')
    const [entry] = loadRecentFlames()
    expect(entry?.audio).toEqual(wiring)
    expect(entry?.flame.renderSettings.exposure).toBe(
      examples.example1.renderSettings.exposure,
    )
  })

  it('stores no wiring when the export had none', () => {
    expect(saveImageJobToRecents(job(undefined))).toBe('saved')
    expect(loadRecentFlames()[0]).not.toHaveProperty('audio')
  })
})
