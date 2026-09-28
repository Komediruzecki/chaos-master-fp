// The Hann window the analyzers apply before the FFT.
import { describe, expect, it } from 'vitest'
import { hannWindow } from './spectralWindow'

describe('hannWindow', () => {
  it('rises from 0 at the first sample to 1 in the middle and back', () => {
    const window = hannWindow(8)
    expect(window).toHaveLength(8)
    expect(window[0]).toBe(0)
    expect(window[2]).toBeCloseTo(0.5, 6)
    expect(window[4]).toBe(1)
    expect(window[6]).toBeCloseTo(0.5, 6)
  })
})
