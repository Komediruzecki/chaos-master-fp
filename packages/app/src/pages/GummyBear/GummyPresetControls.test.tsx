/** Preset actions preserve live simulation until Apply, including reloads and denied clipboard access. */
import { cleanup, fireEvent, render, screen, waitFor, } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GUMMY_PARTICLE_TUNING } from '@/simulation/gummy/gummyParticleTuning'
import { GUMMY_BUILTIN_PRESETS } from './gummyBuiltinPresets'
import { GummyPresetControls } from './GummyPresetControls'
import { createGummyPreset, GUMMY_PRESET_STORAGE_KEY, loadGummyPresets, parseGummyPreset, saveGummyPresets, serializeGummyPreset, } from './gummyPresets'
import type { GummyPresetSettings } from './gummyPresets'

const settings: GummyPresetSettings = {
  palette: 'marble',
  particleMaterial: 'warm',
  softness: 0.8,
  fragility: 0.9,
  tearing: true,
  tuning: { ...DEFAULT_GUMMY_PARTICLE_TUNING },
  grabRadius: 0.16,
  maxPull: 0.65,
  pinnedFeet: true,
  caustics: true,
}
let clipboardDescriptor: PropertyDescriptor | undefined
const entries = new Map<string, string>()
const memoryStorage = {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => {
    entries.set(key, value)
  },
}
beforeEach(() => {
  entries.clear()
  vi.stubGlobal('localStorage', memoryStorage)
  clipboardDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.navigator,
    'clipboard',
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (clipboardDescriptor)
    Object.defineProperty(
      globalThis.navigator,
      'clipboard',
      clipboardDescriptor,
    )
  else Reflect.deleteProperty(globalThis.navigator, 'clipboard')
})
const open = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Presets' }))
const rename = (value: string) =>
  fireEvent.input(screen.getByRole('textbox', { name: 'Preset name' }), {
    target: { value },
  })
const select = (value: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Saved preset' }), {
    target: { value },
  })
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }))

describe('GummyPresetControls', () => {
  it('offers four starting presets without changing saved versions or applying on mount', () => {
    const saved = createGummyPreset('RockGummy', { ...settings, softness: 0.1 })
    saveGummyPresets(undefined, [saved])
    const before = localStorage.getItem(GUMMY_PRESET_STORAGE_KEY)
    const apply = vi.fn()
    render(() => <GummyPresetControls current={settings} onApply={apply} />)
    open()
    select('RockGummy')
    expect(apply).not.toHaveBeenCalled()
    for (const item of GUMMY_BUILTIN_PRESETS) {
      click(item.label)
      expect(apply).toHaveBeenLastCalledWith(item.preset.settings)
      expect(
        screen.getByRole<HTMLInputElement>('textbox', { name: 'Preset name' })
          .value,
      ).toBe(item.preset.name)
      expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('')
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Update selected',
        }).disabled,
      ).toBe(true)
      expect(localStorage.getItem(GUMMY_PRESET_STORAGE_KEY)).toBe(before)
    }
    expect(apply).toHaveBeenCalledTimes(4)
    select('RockGummy')
    click('Apply preset')
    expect(apply).toHaveBeenLastCalledWith(saved.settings)
  })

  it('copies exact RockGummy settings and saves a tuned version without changing the starting preset', async () => {
    const rock = GUMMY_BUILTIN_PRESETS.find(
      (item) => item.id === 'rockgummy',
    )!.preset
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const [current, setCurrent] = createSignal(settings)
    render(() => (
      <GummyPresetControls current={current()} onApply={setCurrent} />
    ))
    open()
    click('RockGummy')
    click('Copy current')
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
    })
    expect(parseGummyPreset(writeText.mock.calls[0]![0] as string)).toEqual(
      rock,
    )
    current().tuning.flow = 0.25
    rename('RockGummy variation')
    click('Save as new')
    expect(loadGummyPresets().presets[0]?.settings.tuning.flow).toBe(0.25)
    click('RockGummy')
    expect(current().tuning.flow).toBe(1)
    expect(rock.settings.tuning.flow).toBe(1)
  })

  it('saves current settings across reload and applies only on request', () => {
    const apply = vi.fn()
    render(() => <GummyPresetControls current={settings} onApply={apply} />)
    expect(screen.queryByRole('region')).toBeNull()
    open()
    rename('Amber stretch')
    click('Save as new')
    expect(loadGummyPresets().presets).toEqual([
      createGummyPreset('Amber stretch', settings),
    ])
    expect(apply).not.toHaveBeenCalled()
    cleanup()
    render(() => (
      <GummyPresetControls
        current={{ ...settings, softness: 0.1 }}
        onApply={apply}
      />
    ))
    open()
    select('Amber stretch')
    expect(apply).not.toHaveBeenCalled()
    click('Apply preset')
    expect(apply).toHaveBeenCalledExactlyOnceWith(settings)
  })

  it('updates the selected preset from reactive controls without adding a duplicate', () => {
    const apply = vi.fn()
    const [current, setCurrent] = createSignal(settings)
    render(() => <GummyPresetControls current={current()} onApply={apply} />)
    open()
    rename('Soft')
    click('Save as new')
    setCurrent({
      ...settings,
      fragility: 0.3,
      tuning: { ...settings.tuning, gravity: 0.2 },
    })
    click('Update selected')
    expect(loadGummyPresets().presets).toEqual([
      createGummyPreset('Soft', current()),
    ])
    click('Save as new')
    expect(screen.getByRole('status').textContent).toContain('already exists')
    expect(loadGummyPresets().presets).toHaveLength(1)
    expect(apply).not.toHaveBeenCalled()
  })

  it('stages a complete import and keeps the selected preset and storage unchanged on invalid import', () => {
    const apply = vi.fn()
    saveGummyPresets(undefined, [createGummyPreset('Saved', settings)])
    const before = localStorage.getItem(GUMMY_PRESET_STORAGE_KEY)
    render(() => <GummyPresetControls current={settings} onApply={apply} />)
    open()
    select('Saved')
    click('Import JSON')
    const input = screen.getByRole('textbox', { name: 'Preset JSON' })
    fireEvent.input(input, {
      target: {
        value: JSON.stringify({
          ...createGummyPreset('Invalid', settings),
          version: 2,
        }),
      },
    })
    click('Import preset')
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('Saved')
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Preset name' })
        .value,
    ).toBe('Saved')
    expect(localStorage.getItem(GUMMY_PRESET_STORAGE_KEY)).toBe(before)
    expect(apply).not.toHaveBeenCalled()
    const imported = createGummyPreset('Floating', {
      ...settings,
      tuning: { ...settings.tuning, gravity: 0 },
      pinnedFeet: false,
    })
    fireEvent.input(input, {
      target: { value: serializeGummyPreset(imported) },
    })
    click('Import preset')
    expect(apply).not.toHaveBeenCalled()
    expect(localStorage.getItem(GUMMY_PRESET_STORAGE_KEY)).toBe(before)
    click('Apply preset')
    expect(apply).toHaveBeenCalledExactlyOnceWith(imported.settings)
  })

  it('copies the latest complete settings without applying or saving them', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const apply = vi.fn()
    const [current, setCurrent] = createSignal(settings)
    render(() => <GummyPresetControls current={current()} onApply={apply} />)
    open()
    rename('Current recipe')
    setCurrent({ ...settings, palette: 'lagoon', maxPull: 1.2 })
    click('Copy current')
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Current preset JSON copied.',
      )
    })
    expect(parseGummyPreset(writeText.mock.calls[0]![0] as string)).toEqual(
      createGummyPreset('Current recipe', current()),
    )
    expect(apply).not.toHaveBeenCalled()
    expect(localStorage.getItem(GUMMY_PRESET_STORAGE_KEY)).toBeNull()
  })

  it('selects full JSON for manual copying when clipboard access is denied', async () => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Blocked')) },
    })
    render(() => <GummyPresetControls current={settings} onApply={vi.fn()} />)
    open()
    click('Copy current')
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Copy was blocked. The JSON is selected so you can copy it manually.',
      )
    })
    const output = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Current preset JSON',
    })
    expect(output.readOnly).toBe(true)
    expect(document.activeElement).toBe(output)
    expect(output.selectionStart).toBe(0)
    expect(output.selectionEnd).toBe(output.value.length)
    expect(parseGummyPreset(output.value).settings).toEqual(settings)
  })

  it('retains presets for the visit and export when storage rejects writes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    vi.spyOn(memoryStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    render(() => <GummyPresetControls current={settings} onApply={vi.fn()} />)
    open()
    rename('For this visit')
    click('Save as new')
    expect(screen.getByRole('status').textContent).toContain(
      'Kept for this visit',
    )
    expect(screen.getByRole('option', { name: 'For this visit' })).toBeDefined()
    click('Copy current')
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
    })
    expect(parseGummyPreset(writeText.mock.calls[0]![0] as string).name).toBe(
      'For this visit',
    )
  })

  it('disables Apply during an unavailable simulation while leaving backup actions accessible', () => {
    const apply = vi.fn()
    const [disabled, setDisabled] = createSignal(true)
    saveGummyPresets(undefined, [createGummyPreset('Saved', settings)])
    render(() => (
      <GummyPresetControls
        current={settings}
        onApply={apply}
        disabled={disabled()}
      />
    ))
    open()
    select('Saved')
    for (const item of GUMMY_BUILTIN_PRESETS) {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: item.label })
          .disabled,
      ).toBe(true)
      click(item.label)
    }
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Apply preset' })
        .disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Copy current' })
        .disabled,
    ).toBe(false)
    click('Apply preset')
    expect(apply).not.toHaveBeenCalled()
    setDisabled(false)
    click('Apply preset')
    expect(apply).toHaveBeenCalledExactlyOnceWith(settings)
  })

  it('deletes only the selected saved preset without applying or changing the current settings', () => {
    const apply = vi.fn()
    saveGummyPresets(undefined, [
      createGummyPreset('First', settings),
      createGummyPreset('Second', settings),
    ])
    render(() => <GummyPresetControls current={settings} onApply={apply} />)
    open()
    select('First')
    click('Delete selected')
    expect(loadGummyPresets().presets.map((preset) => preset.name)).toEqual([
      'Second',
    ])
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Apply preset' })
        .disabled,
    ).toBe(true)
    expect(apply).not.toHaveBeenCalled()
  })
})
