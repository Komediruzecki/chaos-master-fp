// Band levels for audio-reactive mapping: decibels placed on [0, 1] against
// the range each band covers over its own track.
import { describe, expect, it } from 'vitest'
import { amplitudeToDb, bandLevel, createBandPeakNormalizer, normalizeTrackBands, quantileOfSorted, SILENT_DB, trackBandRange, } from './bandNormalization'

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

describe('createBandPeakNormalizer', () => {
  it('reads a band at its own peak as 1 and 45 dB below it as 0', () => {
    const bands = createBandPeakNormalizer()
    expect(bands.levels([amplitude(-20)], 0)).toEqual([1])
    expect(bands.levels([amplitude(-65)], 0)[0]).toBeCloseTo(0, 9)
    expect(bands.levels([amplitude(-42.5)], 0)[0]).toBeCloseTo(0.5, 9)
  })

  it('lets a peak fall by a factor of e, 8.7 dB, in 30 s', () => {
    const bands = createBandPeakNormalizer()
    bands.levels([amplitude(-20)], 0)
    // 30 s on, the peak is 20 log10(e) dB lower: -28.69 dB, the zero at -73.69.
    const fallen = -20 - 20 * Math.log10(Math.E)
    expect(bands.levels([amplitude(-40)], 30)[0]).toBeCloseTo(
      (-40 - (fallen - 45)) / 45,
      9,
    )
  })

  it('follows each band on its own', () => {
    const bands = createBandPeakNormalizer()
    expect(bands.levels([amplitude(-20), amplitude(-60)], 0)).toEqual([1, 1])
    expect(bands.levels([amplitude(-20), amplitude(-80)], 0.02)[1]).toBeCloseTo(
      (-80 - (-60 - (0.02 * 20 * Math.log10(Math.E)) / 30 - 45)) / 45,
      9,
    )
  })

  it('never lets a peak fall below -100 dB, so digital silence reads 0', () => {
    const bands = createBandPeakNormalizer()
    expect(bands.levels([0], 0)).toEqual([0])
    expect(bands.levels([0], 3600)).toEqual([0])
  })
})
