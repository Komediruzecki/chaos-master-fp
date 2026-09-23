import { describe, expect, it } from 'vitest'
import { defaultPalettes } from '@/flame/palettes'
import { paletteLut } from './explorerPalette'

describe('paletteLut', () => {
  it('runs the ramp out and back, so the cycle closes without a seam', () => {
    const palette = defaultPalettes.find((p) => p.entries.length > 2)!
    const lut = paletteLut(palette, 16)
    expect(lut).toHaveLength(32)
    for (let i = 1; i < 8; i += 1) {
      expect(lut[2 * i]).toBeCloseTo(lut[2 * (16 - i)]!, 6)
      expect(lut[2 * i + 1]).toBeCloseTo(lut[2 * (16 - i) + 1]!, 6)
    }
    expect(lut.every(Number.isFinite)).toBe(true)
  })
})
