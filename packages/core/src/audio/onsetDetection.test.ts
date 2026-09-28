// Onsets from the log spectral flux: strengths on [0, 1] at the peaks that
// clear a threshold following the music, 0 everywhere else.
import { describe, expect, it } from 'vitest'
import { createLiveOnsetDetector, detectOnsets, logSpectralFlux, ONSET_LOG_GAIN, } from './onsetDetection'

/** Indices of the non-zero entries. */
function onsetFrames(strengths: Float32Array): number[] {
  return Array.from(strengths.keys()).filter((i) => strengths[i]! > 0)
}

describe('logSpectralFlux', () => {
  it('is the mean rise of log(1 + gain * magnitude) over the bins', () => {
    // One bin of two rises by 1 / gain: log(2) over 2 bins.
    expect(logSpectralFlux([0, 0], [1 / ONSET_LOG_GAIN, 0])).toBeCloseTo(
      Math.log(2) / 2,
      12,
    )
  })

  it('counts a falling bin as 0, not as a negative rise', () => {
    expect(logSpectralFlux([1 / ONSET_LOG_GAIN, 0], [0, 0])).toBe(0)
    expect(
      logSpectralFlux([1 / ONSET_LOG_GAIN, 0], [0, 1 / ONSET_LOG_GAIN]),
    ).toBeCloseTo(Math.log(2) / 2, 12)
  })
})

describe('detectOnsets', () => {
  it('marks the peaks that clear the local threshold, strong against the loud onsets', () => {
    const flux = new Float64Array(90)
    flux[30] = 0.5
    flux[60] = 0.25
    const strengths = detectOnsets(flux, 30)
    expect(onsetFrames(strengths)).toEqual([30, 60])
    // The loud onsets' flux is the 99th percentile, 0.2775 here: 0.5 is past
    // it and reads 1, 0.25 reads 0.25 / 0.2775.
    expect(strengths[30]).toBe(1)
    expect(strengths[60]).toBeCloseTo(0.25 / 0.2775, 6)
  })

  it('keeps two onsets at least 50 ms apart', () => {
    const flux = new Float64Array(120)
    flux[60] = 0.5
    flux[62] = 0.5 // 33 ms later at 60 fps
    flux[70] = 0.5 // 167 ms after the first
    expect(onsetFrames(detectOnsets(flux, 60))).toEqual([60, 70])
  })

  it('finds no onset in silence', () => {
    expect(onsetFrames(detectOnsets(new Float64Array(300), 30))).toEqual([])
  })

  it('finds no onset in a steady hiss', () => {
    // A flux that wobbles by 5% around its level never clears the margin.
    const flux = Float64Array.from({ length: 300 }, (_, i) =>
      i % 2 === 0 ? 0.0059 : 0.0062,
    )
    expect(onsetFrames(detectOnsets(flux, 30))).toEqual([])
  })
})

describe('createLiveOnsetDetector', () => {
  /** The strengths a live detector gives a flux heard `rate` times a second. */
  function liveStrengths(rate: number, flux: (time: number) => number) {
    const detect = createLiveOnsetDetector()
    return Array.from({ length: 10 * rate }, (_, k) => {
      const time = k / rate
      return { time, strength: detect(time, flux(time)) }
    }).filter((entry) => entry.strength > 0)
  }

  it('measures an onset against the loudest flux so far, which fades over 30 s', () => {
    const onsets = liveStrengths(30, (time) =>
      time === 1 ? 0.5 : time === 1.5 ? 0.25 : 0,
    )
    expect(onsets.map((entry) => entry.time)).toEqual([1, 1.5])
    expect(onsets[0]!.strength).toBe(1)
    // Half a second on, the loudest flux has faded to 0.5 exp(-0.5 / 30).
    expect(onsets[1]!.strength).toBeCloseTo(
      0.25 / (0.5 * Math.exp(-0.5 / 30)),
      6,
    )
  })

  it('finds no onset in silence', () => {
    expect(liveStrengths(30, () => 0)).toEqual([])
  })

  it('finds no onset in a steady hiss', () => {
    expect(
      liveStrengths(30, (time) =>
        Math.round(time * 30) % 2 === 0 ? 0.0059 : 0.0062,
      ),
    ).toEqual([])
  })
})
