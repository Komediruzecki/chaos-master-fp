/** Built-in comparisons isolate material response and preserve the exact user-supplied RockGummy recipe. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gummyParticleMaterial } from '@/simulation/gummy/gummyParticleMath'
import { GUMMY_BUILTIN_PRESETS } from './gummyBuiltinPresets'
import { parseGummyPreset, serializeGummyPreset } from './gummyPresets'

afterEach(() => vi.unstubAllGlobals())

describe('built-in gummy presets', () => {
  it('keeps stable IDs in low, mid, high and RockGummy order', () => {
    expect(GUMMY_BUILTIN_PRESETS.map((item) => item.id)).toEqual([
      'low',
      'mid',
      'high',
      'rockgummy',
    ])
  })

  it.each(GUMMY_BUILTIN_PRESETS)(
    '$label is a complete versioned preset that round-trips',
    ({ preset }) => {
      expect(parseGummyPreset(serializeGummyPreset(preset))).toEqual(preset)
    },
  )

  it('preserves the exact RockGummy controls', () => {
    expect(
      GUMMY_BUILTIN_PRESETS.find((item) => item.id === 'rockgummy')?.preset,
    ).toEqual({
      format: 'gummy-material-preset',
      version: 1,
      name: 'RockGummy',
      settings: {
        palette: 'marble',
        particleMaterial: 'warm',
        softness: 0.65,
        fragility: 0.7,
        tearing: true,
        tuning: {
          grabStrength: 0.65,
          flow: 1,
          gravity: 1,
          floorDrag: 8.5,
          viscosity: 0.61,
        },
        grabRadius: 0.26,
        maxPull: 0.6,
        pinnedFeet: true,
        caustics: true,
      },
    })
  })

  it('holds grip, floor and presentation settings fixed for every comparison', () => {
    for (const { preset } of GUMMY_BUILTIN_PRESETS) {
      const settings = preset.settings
      expect({
        palette: settings.palette,
        material: settings.particleMaterial,
        gravity: settings.tuning.gravity,
        grabStrength: settings.tuning.grabStrength,
        floorDrag: settings.tuning.floorDrag,
        grabRadius: settings.grabRadius,
        maxPull: settings.maxPull,
        pinnedFeet: settings.pinnedFeet,
        caustics: settings.caustics,
        tearing: settings.tearing,
      }).toEqual({
        palette: 'marble',
        material: 'warm',
        gravity: 1,
        grabStrength: 0.65,
        floorDrag: 8.5,
        grabRadius: 0.26,
        maxPull: 0.6,
        pinnedFeet: true,
        caustics: true,
        tearing: true,
      })
    }
  })

  it('progresses from firm to mushy in the actual warm material mapping', () => {
    const materials = GUMMY_BUILTIN_PRESETS.slice(0, 3).map(({ preset }) => {
      const settings = preset.settings
      return gummyParticleMaterial(
        settings.softness,
        settings.particleMaterial,
        settings.fragility,
        settings.tuning,
      )
    })
    expect(materials.map((material) => material.relaxationRate)).toEqual([
      1.3125, 5.25, 12.95,
    ])
    expect(materials.map((material) => material.damageRate)).toEqual([
      15, 18, 22.8,
    ])
    expect(materials.map((material) => material.viscosity)).toEqual([
      0.85, 0.7, 0.25,
    ])
    expect(
      materials.map((material) => Math.round(material.shearModulus)),
    ).toEqual([188, 145, 100])
  })

  it('does not read or write device storage when built-ins are loaded', async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    vi.resetModules()
    const loaded = await import('./gummyBuiltinPresets')
    expect(loaded.GUMMY_BUILTIN_PRESETS).toHaveLength(4)
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
})
