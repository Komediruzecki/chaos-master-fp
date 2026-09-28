// Pins where the comfort preset comes from: a remembered choice first, then the
// system's reduced-motion setting, then standard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMFORT_PRESET_STORAGE_KEY, comfortPreset, reloadComfortPreset, setComfortPreset, } from './comfortPreference'

// localStorage is not usable in this runtime; storage is an in-memory map.
const storage = new Map<string, string>()
vi.mock('@/utils/storage', () => ({
  safeGetItem: (key: string) => storage.get(key) ?? null,
  safeSetItem: (key: string, value: string) => {
    storage.set(key, value)
    return true
  },
  safeRemoveItem: (key: string) => {
    storage.delete(key)
  },
}))

function prefersReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
  }))
}

describe('the comfort preset', () => {
  beforeEach(() => {
    storage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is standard when nothing was chosen and the system has no preference', () => {
    prefersReducedMotion(false)
    reloadComfortPreset()
    expect(comfortPreset()).toBe('standard')
  })

  it('is calm when the system asks for reduced motion', () => {
    prefersReducedMotion(true)
    reloadComfortPreset()
    expect(comfortPreset()).toBe('calm')
  })

  it('remembers a choice, which wins over the system', () => {
    prefersReducedMotion(true)
    reloadComfortPreset()
    setComfortPreset('intense')
    expect(storage.get(COMFORT_PRESET_STORAGE_KEY)).toBe('intense')
    reloadComfortPreset()
    expect(comfortPreset()).toBe('intense')
  })

  it('ignores a stored value that is not a preset', () => {
    prefersReducedMotion(false)
    storage.set(COMFORT_PRESET_STORAGE_KEY, 'turbo')
    reloadComfortPreset()
    expect(comfortPreset()).toBe('standard')
  })
})
