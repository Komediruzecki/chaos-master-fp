// Picking beats out of a band flux: a threshold that follows the music, and a
// minimum gap held in seconds.
import { describe, expect, it } from 'vitest'
import { centredThresholds, createCausalPicker, createLiveBeatDetector, detectBeatFrames, } from './peakPicking'

/** A flux at `fps` with a peak every 0.5 s: `loud` for the first 8 s, then
 *  `quiet`, over a floor of 0.001, 16 s in all. */
function loudThenQuiet(fps: number, loud: number, quiet: number): number[] {
  const flux = Array.from({ length: 16 * fps }, () => 0.001)
  for (let at = fps / 2; at < flux.length; at += fps / 2) {
    flux[at] = at < 8 * fps ? loud : quiet
  }
  return flux
}

describe('centredThresholds', () => {
  it('is the mean plus sigmas deviations of the values around each index', () => {
    const signal = [0, 0, 0, 10, 0, 0, 0]
    expect(Array.from(centredThresholds(signal, 1, 0))).toEqual([
      0,
      0,
      10 / 3,
      10 / 3,
      10 / 3,
      0,
      0,
    ])
    // Around index 3 the window is [0, 10, 0]: mean 10/3, deviation sqrt(200)/3.
    expect(centredThresholds(signal, 1, 1.5)[3]).toBeCloseTo(
      10 / 3 + (1.5 * Math.sqrt(200)) / 3,
      12,
    )
  })
})

describe('detectBeatFrames', () => {
  it('keeps the beats of a quiet passage that follows a loud one', () => {
    const beats = [...detectBeatFrames(loudThenQuiet(30, 1, 0.05), 30)]
    // Every loud peak, 15 to 225; the quiet ones from 300 on. The four quiet
    // peaks within 2 s of the loud passage sit under its threshold.
    expect(beats).toEqual([
      15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 300,
      315, 330, 345, 360, 375, 390, 405, 420, 435, 450, 465,
    ])
  })

  it('holds the minimum gap at 0.1 s whatever the frame rate', () => {
    const at60 = Array.from({ length: 120 }, () => 0)
    at60[60] = 1
    at60[64] = 1 // 67 ms later: too soon for a second beat
    at60[80] = 1 // 333 ms after the first: a beat
    expect([...detectBeatFrames(at60, 60)]).toEqual([60, 80])
    const at30 = Array.from({ length: 60 }, () => 0)
    at30[30] = 1
    at30[33] = 1 // 100 ms later: a beat
    expect([...detectBeatFrames(at30, 30)]).toEqual([30, 33])
  })

  it('rounds the minimum gap up to whole frames at 24 and 25 fps', () => {
    // 0.1 s is 2.4 frames at 24 fps: two frames, 83 ms, is too soon; three is not.
    const at24 = Array.from({ length: 96 }, () => 0)
    at24[48] = 1
    at24[50] = 1 // 83 ms later: too soon
    at24[53] = 1 // 208 ms after the first: a beat
    expect([...detectBeatFrames(at24, 24)]).toEqual([48, 53])
    // 2.5 frames at 25 fps: two frames, 80 ms, is too soon; three, 120 ms, is not.
    const at25 = Array.from({ length: 100 }, () => 0)
    at25[50] = 1
    at25[52] = 1 // 80 ms later: too soon
    at25[55] = 1 // 200 ms after the first: a beat
    expect([...detectBeatFrames(at25, 25)]).toEqual([50, 55])
  })

  it('marks the frame where the flux peaks, not the first frame that rises', () => {
    const flux = Array.from({ length: 90 }, () => 0)
    flux[30] = 0.5 // the attack starts
    flux[31] = 1 // and peaks here
    expect([...detectBeatFrames(flux, 30)]).toEqual([31])
  })

  it('finds no beat in silence', () => {
    expect(detectBeatFrames(new Float64Array(300), 30).size).toBe(0)
  })
})

describe('createCausalPicker', () => {
  const options = { windowSeconds: 1, sigmas: 1.5, minGapSeconds: 0.1 }

  it('fires when a value rises past the mean + 1.5σ of the last second', () => {
    const pick = createCausalPicker(options)
    const fired = Array.from({ length: 45 }, (_, k) =>
      pick(k / 30, k === 30 ? 1 : 0),
    )
    expect(fired.flatMap((event, k) => (event ? [k] : []))).toEqual([30])
  })

  it('needs a value to clear the threshold by the margin it is given', () => {
    const pick = createCausalPicker(options)
    for (let k = 0; k < 30; k++) pick(k / 30, k % 2 === 0 ? 0.9 : 1)
    // The last second holds 0.9 and 1 in turn, and now 1.1: its threshold is
    // about 1.04, so 1.1 falls short by the margin.
    expect(pick(1, 1.1, 0.1)).toBe(false)
    expect(pick(31 / 30, 0.9)).toBe(false)
    expect(pick(32 / 30, 1.2, 0.1)).toBe(true)
  })

  it('keeps events at least minGapSeconds apart', () => {
    const pick = createCausalPicker(options)
    for (let k = 0; k < 30; k++) pick(k / 60, 0)
    expect(pick(0.5, 1)).toBe(true)
    expect(pick(0.55, 0)).toBe(false)
    expect(pick(0.583, 1)).toBe(false) // 83 ms after the last
    expect(pick(0.6, 0)).toBe(false)
    expect(pick(0.65, 1)).toBe(true) // 150 ms after it
  })
})

describe('createLiveBeatDetector', () => {
  it('finds the same beats whether it is asked 30 or 60 times a second', () => {
    const beatTimes = (rate: number) => {
      const detect = createLiveBeatDetector()
      const times: number[] = []
      for (let k = 0; k < 6 * rate; k++) {
        const time = k / rate
        // A flux spike every half second from 1 s on.
        const spike = time >= 1 && k % (rate / 2) === 0
        if (detect(time, spike ? 1 : 0.01)) times.push(time)
      }
      return times
    }
    expect(beatTimes(30)).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5])
    expect(beatTimes(60)).toEqual(beatTimes(30))
  })
})
