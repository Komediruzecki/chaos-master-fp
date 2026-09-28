// Pins the comfort presets: the standard caps as numbers, and that every cap
// grows from calm to standard to intense.
import { describe, expect, it } from 'vitest'
import { COMFORT_CAPS, COMFORT_PRESETS } from './comfortPresets'
import type { ComfortCaps } from './comfortPresets'

describe('comfort presets', () => {
  it('orders the presets calm, standard, intense', () => {
    expect(COMFORT_PRESETS).toEqual(['calm', 'standard', 'intense'])
  })

  it('pins the standard caps', () => {
    const caps = COMFORT_CAPS.standard
    expect(caps.zoomLogRate).toBe(0.35)
    expect(caps.paletteTurnsPerSecond).toBeCloseTo(45 / 360, 12)
    expect(caps.paletteSpeedRate).toBeCloseTo(0.125 / 0.298, 12)
    expect(caps.brightnessWindowRange).toBe(0.18)
    expect(caps.brightnessWindowSeconds).toBe(0.5)
    expect(caps.brightnessRate).toBe(0.6)
    expect(caps.affineLinearRate).toBeCloseTo((10 * Math.PI) / 180, 12)
    expect(caps.affineOffsetRate).toBe(0.35)
    expect(caps.probabilityLogRate).toBe(0.6)
    expect(caps.colorRate).toBeCloseTo(0.1111, 4)
    expect(caps.colorSpeedRate).toBeCloseTo(0.25, 12)
    expect(caps.variationWeightRate).toBe(0.35)
  })

  it('grows every cap from calm to standard to intense', () => {
    const keys = Object.keys(COMFORT_CAPS.standard) as (keyof ComfortCaps)[]
    const growing = keys.filter(
      (key) =>
        COMFORT_CAPS.calm[key] < COMFORT_CAPS.standard[key] &&
        COMFORT_CAPS.standard[key] < COMFORT_CAPS.intense[key],
    )
    // The window length is the one shared constant: rule 2 measures over 500 ms.
    expect(keys.filter((key) => !growing.includes(key))).toEqual([
      'brightnessWindowSeconds',
    ])
  })
})
