// Picking beats out of a band flux: a threshold that follows the music, and a
// minimum gap held in seconds.
import { describe, expect, it } from 'vitest'
import { centredThresholds, detectBeatFrames } from './peakPicking'

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
