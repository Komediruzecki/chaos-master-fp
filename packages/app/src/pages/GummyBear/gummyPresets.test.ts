/** Material preset boundaries reject malformed imports before storage or live settings can change. */
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GUMMY_PARTICLE_TUNING, GUMMY_PARTICLE_TUNING_RANGES, } from '@/simulation/gummy/gummyParticleTuning'
import { createGummyPreset, GUMMY_PRESET_LIMIT, GUMMY_PRESET_STORAGE_KEY, loadGummyPresets, parseGummyPreset, saveGummyPresets, serializeGummyPreset, } from './gummyPresets'
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
const sample = () => createGummyPreset('Marbled gummy', settings)

describe('gummy material presets', () => {
  it('round-trips every material control without fixture, playback or camera state', () => {
    const preset = sample()
    expect(parseGummyPreset(serializeGummyPreset(preset))).toEqual({
      format: 'gummy-material-preset',
      version: 1,
      name: 'Marbled gummy',
      settings,
    })
    expect(preset.settings).not.toBe(settings)
    expect(preset.settings.tuning).not.toBe(settings.tuning)
    preset.settings.tuning.flow = 0
    expect(settings.tuning.flow).toBe(1)
  })

  it.each([
    ['version', { ...sample(), version: 2 }],
    ['format', { ...sample(), format: 'flame-preset' }],
    [
      'missing root field',
      { format: 'gummy-material-preset', version: 1, settings },
    ],
    ['unexpected root field', { ...sample(), fixture: 'rook' }],
    [
      'unexpected settings field',
      { ...sample(), settings: { ...settings, paused: true } },
    ],
    ['missing tuning', { ...sample(), settings: { ...settings, tuning: {} } }],
    ['palette', { ...sample(), settings: { ...settings, palette: 'purple' } }],
    [
      'material',
      { ...sample(), settings: { ...settings, particleMaterial: 'hot' } },
    ],
    ['boolean', { ...sample(), settings: { ...settings, caustics: 1 } }],
    [
      'numeric string',
      { ...sample(), settings: { ...settings, softness: '0.5' } },
    ],
    ['array', []],
    ['null', null],
    ['empty name', { ...sample(), name: '  ' }],
    ['long name', { ...sample(), name: 'a'.repeat(61) }],
    ['multiline name', { ...sample(), name: 'Two\nlines' }],
  ])('rejects %s rather than filling or merging defaults', (_label, value) => {
    expect(() => parseGummyPreset(JSON.stringify(value))).toThrow()
  })

  it.each([
    ['softness', -0.01],
    ['softness', 1.01],
    ['fragility', -0.1],
    ['fragility', 1.1],
    ['grabRadius', 0.079],
    ['grabRadius', 0.401],
    ['maxPull', 0.19],
    ['maxPull', 1.81],
  ])('rejects %s outside its supported range: %s', (key, value) => {
    expect(() =>
      parseGummyPreset(
        JSON.stringify({
          ...sample(),
          settings: { ...settings, [key]: value },
        }),
      ),
    ).toThrow()
  })

  it.each(Object.entries(GUMMY_PARTICLE_TUNING_RANGES))(
    'uses the solver bounds for %s',
    (key, range) => {
      for (const value of [range.min - 0.01, range.max + 0.01]) {
        expect(() =>
          parseGummyPreset(
            JSON.stringify({
              ...sample(),
              settings: {
                ...settings,
                tuning: { ...settings.tuning, [key]: value },
              },
            }),
          ),
        ).toThrow()
      }
      for (const value of [range.min, range.max]) {
        const changed = {
          ...settings,
          tuning: { ...settings.tuning, [key]: value },
        }
        expect(
          parseGummyPreset(
            serializeGummyPreset(createGummyPreset('Bounds', changed)),
          ).settings,
        ).toEqual(changed)
      }
    },
  )

  it('rejects invalid, oversized and overflowing JSON numbers', () => {
    expect(() => parseGummyPreset('{')).toThrow('incomplete or invalid')
    expect(() => parseGummyPreset(' '.repeat(16_385))).toThrow('too large')
    expect(() =>
      parseGummyPreset(
        serializeGummyPreset(sample()).replace(
          '"softness": 0.8',
          '"softness": 1e309',
        ),
      ),
    ).toThrow('Softness')
    expect(() =>
      createGummyPreset('Not finite', { ...settings, maxPull: Number.NaN }),
    ).toThrow('Maximum pull')
  })

  it('persists a versioned library and restores complete presets', () => {
    const entries = new Map<string, string>()
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value)
      },
    }
    expect(loadGummyPresets(storage)).toEqual({ presets: [] })
    saveGummyPresets(storage, [sample()])
    expect(JSON.parse(entries.get(GUMMY_PRESET_STORAGE_KEY)!)).toEqual({
      format: 'gummy-material-presets',
      version: 1,
      presets: [sample()],
    })
    expect(loadGummyPresets(storage)).toEqual({ presets: [sample()] })
  })

  it('validates the whole library before writing and rejects duplicate names', () => {
    const storage = { setItem: vi.fn() }
    expect(() => {
      saveGummyPresets(storage, [
        sample(),
        createGummyPreset('MARBLED GUMMY', settings),
      ])
    }).toThrow('already exists')
    expect(() => {
      saveGummyPresets(
        storage,
        Array.from({ length: GUMMY_PRESET_LIMIT + 1 }, (_, index) =>
          createGummyPreset(`Preset ${index}`, settings),
        ),
      )
    }).toThrow('40')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('reports blocked or corrupt storage without replacing its contents', () => {
    const corrupt = { getItem: () => '{', setItem: vi.fn() }
    expect(loadGummyPresets(corrupt)).toEqual({
      presets: [],
      error: expect.stringContaining('could not be loaded'),
    })
    expect(corrupt.setItem).not.toHaveBeenCalled()
    expect(
      loadGummyPresets({
        getItem: () => {
          throw new Error('Blocked')
        },
      }).error,
    ).toContain('Copy current still works')
  })
})
