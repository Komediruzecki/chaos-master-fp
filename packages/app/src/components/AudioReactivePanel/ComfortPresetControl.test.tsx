// Pins the Comfort control: one radio per preset, the active one checked, and
// a click choosing and remembering a preset.
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMFORT_PRESET_STORAGE_KEY, reloadComfortPreset, } from '@/comfort/comfortPreference'
import { ComfortPresetControl } from './ComfortPresetControl'

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

describe('ComfortPresetControl', () => {
  afterEach(() => {
    cleanup()
    storage.clear()
  })

  it('checks the active preset and remembers a new choice', () => {
    storage.set(COMFORT_PRESET_STORAGE_KEY, 'standard')
    reloadComfortPreset()
    render(() => <ComfortPresetControl />)

    const group = screen.getByRole('radiogroup', { name: 'Comfort limits' })
    const radios = screen.getAllByRole('radio')
    expect(group).toBeDefined()
    expect(radios.map((radio) => radio.textContent)).toEqual([
      'Calm',
      'Standard',
      'Intense',
    ])
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ])

    fireEvent.click(screen.getByRole('radio', { name: 'Calm' }))
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ])
    expect(storage.get(COMFORT_PRESET_STORAGE_KEY)).toBe('calm')
  })
})
