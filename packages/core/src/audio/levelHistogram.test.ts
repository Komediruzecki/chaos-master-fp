// A running histogram of levels in dB: quantiles weighted by audio time, over
// a window that forgets.
import { describe, expect, it } from 'vitest'
import { createLevelHistogram, LEVEL_BIN_DB } from './levelHistogram'

describe('createLevelHistogram', () => {
  it('is empty until a level stands for some audio time', () => {
    const histogram = createLevelHistogram(10)
    expect(histogram.quantile(0.5)).toBeUndefined()
    // The first level has no time before it to stand for.
    histogram.add(0, -60)
    expect(histogram.quantile(0.5)).toBeUndefined()
    expect(histogram.seconds()).toBe(0)
  })

  it('weighs each level by the audio time since the one before', () => {
    const histogram = createLevelHistogram(10)
    histogram.add(0, -60)
    for (let k = 1; k <= 9; k++) histogram.add(k / 10, -60)
    histogram.add(1, -20)
    expect(histogram.seconds()).toBeCloseTo(1, 9)
    // The median is 0.5 s into the 0.9 s at -60 dB: 5/9 of the way up its bin.
    expect(histogram.quantile(0.5)).toBeCloseTo(-60 + (5 / 9) * LEVEL_BIN_DB, 9)
    // The 95th percentile is half way into the 0.1 s at -20 dB.
    expect(histogram.quantile(0.95)).toBeCloseTo(-20 + LEVEL_BIN_DB / 2, 9)
  })

  it('counts a level for no more than 0.1 s, however long since the last', () => {
    const histogram = createLevelHistogram(10)
    histogram.add(0, -60)
    histogram.add(5, -20)
    expect(histogram.seconds()).toBeCloseTo(0.1, 9)
  })

  it('forgets a level once it is older than the window', () => {
    const histogram = createLevelHistogram(10)
    histogram.add(-0.1, -20)
    histogram.add(0, -20)
    histogram.add(9, -60)
    expect(histogram.quantile(1)).toBeCloseTo(-20 + LEVEL_BIN_DB, 9)
    histogram.add(10.5, -60)
    expect(histogram.quantile(1)).toBeCloseTo(-60 + LEVEL_BIN_DB, 9)
    expect(histogram.seconds()).toBeCloseTo(0.2, 9)
  })

  it('holds a level below digital silence or above full scale in its end bins', () => {
    const histogram = createLevelHistogram(10)
    histogram.add(0, -300)
    histogram.add(0.1, -300)
    expect(histogram.quantile(0)).toBe(-200)
    histogram.add(0.2, Number.NaN)
    expect(histogram.quantile(1)).toBe(-200 + LEVEL_BIN_DB)
    histogram.add(0.3, 100)
    expect(histogram.quantile(1)).toBe(40)
  })
})
