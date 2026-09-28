// Band levels for audio-reactive mapping: decibels placed on [0, 1] against
// the range each band covers over its own track.
import { describe, expect, it } from 'vitest'
import { amplitudeToDb, bandLevel, createLiveBandNormalizer, noiseWobbleDb, normalizeTrackBands, quantileOfSorted, SILENT_DB, trackBandRange, } from './bandNormalization'

/** The amplitude of a level in dB. */
const amplitude = (db: number) => 10 ** (db / 20)

/** 101 levels, -60 dB to -20 dB in 0.4 dB steps. */
const RAMP_DB = Array.from({ length: 101 }, (_, i) => -60 + 0.4 * i)

describe('amplitudeToDb', () => {
  it('reads full scale as 0 dB and each tenth as 20 dB less', () => {
    expect(amplitudeToDb(1)).toBe(0)
    expect(amplitudeToDb(0.1)).toBeCloseTo(-20, 12)
    expect(amplitudeToDb(0.001)).toBeCloseTo(-60, 12)
  })

  it('holds digital silence at SILENT_DB instead of minus infinity', () => {
    expect(amplitudeToDb(0)).toBe(SILENT_DB)
    expect(SILENT_DB).toBe(-200)
  })
})

describe('quantileOfSorted', () => {
  it('interpolates between the two nearest ranks', () => {
    const sorted = [0, 10, 20, 30, 40]
    expect(quantileOfSorted(sorted, 0.1)).toBeCloseTo(4, 12)
    expect(quantileOfSorted(sorted, 0.98)).toBeCloseTo(39.2, 12)
    expect(quantileOfSorted(sorted, 1)).toBe(40)
  })

  it('is 0 for no values', () => {
    expect(quantileOfSorted([], 0.5)).toBe(0)
  })
})

describe('trackBandRange', () => {
  it('reads the 10th percentile as 0 and the 98th as 1', () => {
    const range = trackBandRange(RAMP_DB)
    expect(range.floorDb).toBeCloseTo(-56, 9)
    expect(range.spanDb).toBeCloseTo(35.2, 9)
    expect(bandLevel(-56, range)).toBeCloseTo(0, 9)
    expect(bandLevel(-38.4, range)).toBeCloseTo(0.5, 9)
    expect(bandLevel(-20.8, range)).toBeCloseTo(1, 9)
  })

  it('keeps the zero within 45 dB of the top, so a silent intro does not squash the music', () => {
    const levels = [...Array.from({ length: 60 }, () => SILENT_DB), ...RAMP_DB]
    const range = trackBandRange(levels)
    // p98 of the 161 levels sits at rank 156.8, which is RAMP_DB index 96.8:
    // -21.28 dB. p10 is silence, so the zero goes 45 dB below the top instead.
    expect(range.floorDb).toBeCloseTo(-66.28, 9)
    expect(range.spanDb).toBeCloseTo(45, 9)
  })

  it('stretches a band that never moves over 6 dB, so it reads 0 instead of flickering', () => {
    const range = trackBandRange(Array.from({ length: 50 }, () => -30))
    expect(range).toEqual({ floorDb: -30, spanDb: 6 })
    expect(bandLevel(-30, range)).toBe(0)
  })

  it('reads a level outside the range as 0 or 1', () => {
    const range = { floorDb: -50, spanDb: 20 }
    expect(bandLevel(-80, range)).toBe(0)
    expect(bandLevel(-10, range)).toBe(1)
  })
})

describe('normalizeTrackBands', () => {
  it('places each band against its own range over the whole track', () => {
    // Band 0 swells from -60 dB to -20 dB; band 1 holds at -40 dB.
    const frames = RAMP_DB.map((db) => [10 ** (db / 20), 0.01])
    const levels = normalizeTrackBands(frames)
    expect(levels).toHaveLength(101)
    expect(levels[0]![0]).toBe(0)
    expect(levels[54]![0]).toBeCloseTo(0.5, 9)
    expect(levels[100]![0]).toBe(1)
    expect(levels.every((frame) => frame[1] === 0)).toBe(true)
  })

  it('reads a silent track as 0 in every band', () => {
    const levels = normalizeTrackBands([
      [0, 0],
      [0, 0],
    ])
    expect(levels).toEqual([
      [0, 0],
      [0, 0],
    ])
  })

  it('returns no frames for no frames', () => {
    expect(normalizeTrackBands([])).toEqual([])
  })
})

describe('noiseWobbleDb', () => {
  it('is how far a band of n bins wobbles on noise, from 14.6 dB for one bin down', () => {
    // At or above the p10 to p90 spread measured on white, pink and brown
    // noise: 14.6 dB for 1 bin, 5.4 for 9, 2.0 for 69, 0.5 for 650.
    expect(noiseWobbleDb(1)).toBe(16)
    expect(noiseWobbleDb(9)).toBeCloseTo(5.95, 2)
    expect(noiseWobbleDb(69)).toBeCloseTo(2.38, 2)
    expect(noiseWobbleDb(650)).toBeCloseTo(0.87, 2)
    expect(noiseWobbleDb(0)).toBe(0)
  })
})

describe('createLiveBandNormalizer', () => {
  /** Feeds `levelDb(time)` to one band of `bins` bins 30 times a second up to
   *  `seconds`, and returns the reading at each time. */
  function readings(
    bins: number,
    seconds: number,
    levelDb: (time: number) => number,
  ): Map<number, number> {
    const bands = createLiveBandNormalizer([bins])
    const out = new Map<number, number>()
    for (let k = 0; k <= seconds * 30; k++) {
      const time = k / 30
      out.set(k, bands.levels([amplitude(levelDb(time))], time)[0]!)
    }
    return out
  }

  it('reads a band at its quiet level as 0 and at its loud level as 1', () => {
    // -60 dB and -20 dB by turns, a second each, for 20 s, and -40 dB once.
    const levels = readings(93, 20, (time) =>
      time === 20 ? -40 : Math.floor(time) % 2 === 0 ? -20 : -60,
    )
    // The zero is the 10th percentile, in the -60 dB bin at -59.9, plus the
    // 2.08 dB 93 bins wobble on noise; the top, the 98th, is at -19.52.
    const zero = -59.9 + noiseWobbleDb(93)
    expect(levels.get(19 * 30 + 15)).toBe(0)
    expect(levels.get(18 * 30 + 15)).toBeCloseTo(
      (-20 - zero) / (-19.52 - zero),
      3,
    )
    expect(levels.get(20 * 30)).toBeCloseTo((-40 - zero) / (-19.52 - zero), 3)
  })

  it('reads 0 for a band that moves no more than its bins wobble on noise', () => {
    // 10 dB up and down in a band of 2 bins, which noise alone moves 11.7 dB.
    const levels = readings(2, 20, (time) =>
      Math.round(time * 30) % 2 === 0 ? -65 : -55,
    )
    expect(new Set(levels.values())).toEqual(new Set([0]))
  })

  it('holds its zero at the median until it has heard 5 s', () => {
    // Levels from -64 to -56 dB in 2 dB steps, round and round.
    const cycle = (time: number) => -64 + 2 * (Math.round(time * 30) % 5)
    const levels = readings(1000, 10, (time) =>
      Math.abs(time - 1) < 1e-9 || Math.abs(time - 9) < 1e-9
        ? -60.5
        : cycle(time),
    )
    // After a second, -60.5 dB is under the median and reads 0; after 9 s,
    // with the zero down at the 10th percentile, it reads a third of the way.
    expect(levels.get(30)).toBe(0)
    expect(levels.get(270)).toBeCloseTo(0.338, 3)
  })

  it('forgets a loud passage 30 s after it', () => {
    // 10 s at -20 dB, then -60 dB, and a -40 dB probe now and then.
    const probes = [25, 45]
    const levels = readings(93, 45, (time) =>
      probes.some((probe) => Math.abs(time - probe) < 1e-9)
        ? -40
        : time < 10
          ? -20
          : -60,
    )
    // 15 s on the loud passage is still the top; 35 s on it is gone, and the
    // top is the least span, 6 dB, over the zero.
    expect(levels.get(25 * 30)).toBeCloseTo(0.47, 2)
    expect(levels.get(45 * 30)).toBe(1)
  })

  it('follows each band on its own', () => {
    const bands = createLiveBandNormalizer([93, 93])
    let last: number[] = []
    for (let k = 0; k <= 600; k++) {
      const loud = Math.floor(k / 30) % 2 === 0
      last = bands.levels(
        [amplitude(loud ? -20 : -60), amplitude(loud ? -60 : -20)],
        k / 30,
      )
    }
    // At 20 s the first band is loud and the second quiet.
    expect(last[0]).toBeGreaterThan(0.95)
    expect(last[1]).toBe(0)
  })

  it('reads digital silence as 0', () => {
    const levels = readings(93, 5, () => SILENT_DB)
    expect(new Set(levels.values())).toEqual(new Set([0]))
    const bands = createLiveBandNormalizer([93])
    expect(bands.levels([0], 0)).toEqual([0])
  })
})
