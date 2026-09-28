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

  it('rounds the 50 ms gap up to whole frames at 24 and 25 fps', () => {
    // 50 ms is 1.2 frames at 24 fps and 1.25 at 25: the next frame, 42 or
    // 40 ms on, is too soon for a second onset.
    const at24 = new Float64Array(96)
    at24[48] = 0.5
    at24[49] = 0.5 // 42 ms later: too soon
    at24[60] = 0.5 // 500 ms after the first
    expect(onsetFrames(detectOnsets(at24, 24))).toEqual([48, 60])
    const at25 = new Float64Array(100)
    at25[50] = 0.5
    at25[51] = 0.5 // 40 ms later: too soon
    at25[62] = 0.5 // 480 ms after the first
    expect(onsetFrames(detectOnsets(at25, 25))).toEqual([50, 62])
  })

  it('finds no onset in silence', () => {
    expect(onsetFrames(detectOnsets(new Float64Array(300), 30))).toEqual([])
  })

  it('finds no onset on a frame where no band stands over its zero', () => {
    const flux = new Float64Array(90)
    flux[30] = 0.5
    flux[60] = 0.5
    const audible = Array.from(flux, (_, i) => i !== 30)
    expect(onsetFrames(detectOnsets(flux, 30, audible))).toEqual([60])
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
  /** The strengths a live detector gives a flux heard `rate` times a second
   *  for `seconds`. */
  function liveStrengths(
    rate: number,
    flux: (time: number) => number,
    seconds = 10,
  ) {
    const detect = createLiveOnsetDetector()
    return Array.from({ length: seconds * rate }, (_, k) => {
      const time = k / rate
      return { time, strength: detect(time, flux(time)) }
    }).filter((entry) => entry.strength > 0)
  }

  it('measures an onset against the loud flux of the last 10 s, its 99th percentile', () => {
    const onsets = liveStrengths(30, (time) =>
      time === 1 ? 0.5 : time === 1.5 ? 0.25 : 0,
    )
    expect(onsets.map((entry) => entry.time)).toEqual([1, 1.5])
    expect(onsets[0]!.strength).toBe(1)
    // At 1.5 s the 99th percentile of the last 1.5 s lies in the 0.5 dB bin
    // the 0.5 spike is in, at -6.225 dB: 0.4883. The 0.25 spike reads 0.512.
    expect(onsets[1]!.strength).toBeCloseTo(0.512, 3)
  })

  it('does not let one knock ten times louder quieten the onsets 2 s after it', () => {
    // A flux of 0.25 every half second, and a knock of 2.5 at 5.3 s.
    const spikes = (time: number) =>
      Math.round(time * 30) % 15 === 0 ? 0.25 : 0
    const knocked = liveStrengths(
      30,
      (time) => (Math.abs(time - 5.3) < 1e-9 ? 2.5 : spikes(time)),
      20,
    )
    // Every spike from 7.5 s to 19.5 s is an onset as strong as before it.
    const later = knocked.filter((entry) => entry.time >= 7.3)
    expect(later).toHaveLength(25)
    expect(new Set(later.map((entry) => entry.strength))).toEqual(new Set([1]))
  })

  it('forgets a loud passage within 10 s of its end', () => {
    // A flux of 1 every half second for 10 s, then of 0.1.
    const onsets = liveStrengths(
      30,
      (time) =>
        Math.round(time * 30) % 15 === 0 && time > 0
          ? time < 10
            ? 1
            : 0.1
          : 0,
      25,
    )
    // A tenth of the loud flux misses the margin, 5% of it, until the loud
    // passage is under 1% of the last 10 s: two spikes, at 9 and 9.5 s, by
    // 18.5 s. From there the quiet spikes are the loud onsets.
    const quiet = onsets.filter((entry) => entry.time > 10)
    expect(quiet.map((entry) => entry.time)).toEqual([
      18.5, 19, 19.5, 20, 20.5, 21, 21.5, 22, 22.5, 23, 23.5, 24, 24.5,
    ])
    expect(quiet[0]!.strength).toBeCloseTo(0.944, 3)
    expect(quiet.at(-1)!.strength).toBeCloseTo(0.952, 3)
  })

  it('finds no onset in silence', () => {
    expect(liveStrengths(30, () => 0)).toEqual([])
  })

  it('finds no onset while no band stands over its zero', () => {
    const detect = createLiveOnsetDetector()
    const onsets = Array.from({ length: 90 }, (_, k) => {
      const spike = k === 30 || k === 60
      return detect(k / 30, spike ? 0.5 : 0, k !== 30) > 0 ? k : -1
    }).filter((k) => k >= 0)
    expect(onsets).toEqual([60])
  })

  it('finds no onset in a steady hiss', () => {
    expect(
      liveStrengths(30, (time) =>
        Math.round(time * 30) % 2 === 0 ? 0.0059 : 0.0062,
      ),
    ).toEqual([])
  })
})
