// Onsets: the moments a sound starts, a drum hit, a pluck, a consonant. The
// detection function is the log spectral flux, how far the spectrum rose since
// the last frame on a log scale, so a hi-hat counts next to a kick. A frame is
// an onset where that flux peaks above a threshold that follows the music; its
// value is a strength on [0, 1], and 0 between onsets.

import { amplitudeToDb, quantileOfSorted } from './bandNormalization'
import { createLevelHistogram } from './levelHistogram'
import { centredThresholds, createCausalPicker, gapInFrames, } from './peakPicking'

/** The gain inside log(1 + gain * |X|). Puts music's typical bins, 1e-4 to
 *  1e-2 of full scale, on the logarithmic part of the curve. */
export const ONSET_LOG_GAIN = 1000

/** How wide the window an onset's threshold is measured over is, in seconds. */
export const ONSET_WINDOW_SECONDS = 1

/** The least time between two onsets, in seconds. */
export const ONSET_MIN_GAP_SECONDS = 0.05

/** How far past its threshold a peak must reach, as a share of the loud
 *  onsets' flux. Keeps a steady hiss from firing on its own wobble. */
export const ONSET_MARGIN = 0.05

/** The least flux the loud onsets are measured against, so the rounding noise
 *  of a silent track is not scaled up into onsets. */
export const ONSET_FLUX_FLOOR = 1e-4

/** Where the loud onsets' flux sits among all of it: the 99th percentile, so
 *  a single knock, a hop or two, is not what the rest is measured against. */
export const LOUD_ONSET_QUANTILE = 0.99

/** How far back a live input's loud onsets are measured, in seconds of audio:
 *  a knock is a hop or two of these 10 s, so it does not quieten the onsets
 *  after it, and a loud passage no longer sets the scale 10 s after it ends. */
export const LIVE_ONSET_LOUD_SECONDS = 10

/**
 * The log spectral flux between two magnitude spectra: the mean over the bins
 * of how far log(1 + gain * |X|) rose. A falling bin counts 0 (half-wave
 * rectified), so a sound ending is not an onset.
 */
export function logSpectralFlux(
  previous: ArrayLike<number>,
  current: ArrayLike<number>,
): number {
  const bins = Math.min(previous.length, current.length)
  if (bins === 0) return 0
  let rise = 0
  for (let k = 0; k < bins; k++) {
    const step =
      Math.log1p(ONSET_LOG_GAIN * current[k]!) -
      Math.log1p(ONSET_LOG_GAIN * previous[k]!)
    if (step > 0) rise += step
  }
  return rise / bins
}

/**
 * Onsets in a whole file, from its flux frame by frame. A frame is an onset
 * when its flux is a local peak that clears the mean + 1.5σ of the
 * ONSET_WINDOW_SECONDS around it by ONSET_MARGIN, at least
 * ONSET_MIN_GAP_SECONDS after the last onset in whole frames (`gapInFrames`).
 * Flux is measured against the track's loud onsets, its 99th percentile, and
 * an onset's strength is that ratio capped at 1. `fps` is the analyzer's real
 * frame rate.
 */
export function detectOnsets(
  flux: ArrayLike<number>,
  fps: number,
): Float32Array {
  const strengths = new Float32Array(flux.length)
  const loud = quantileOfSorted(
    Float64Array.from(flux).sort(),
    LOUD_ONSET_QUANTILE,
  )
  const scale = Math.max(loud, ONSET_FLUX_FLOOR)
  const relative = Float64Array.from(flux, (value) => value / scale)
  const halfWidth = Math.max(1, Math.round((ONSET_WINDOW_SECONDS * fps) / 2))
  const thresholds = centredThresholds(relative, halfWidth, 1.5)
  const minGap = gapInFrames(ONSET_MIN_GAP_SECONDS, fps)
  let last = -Infinity
  for (let i = 1; i < relative.length; i++) {
    const value = relative[i]!
    const isPeak =
      value >= relative[i - 1]! &&
      (i + 1 === relative.length || value >= relative[i + 1]!)
    if (isPeak && value > thresholds[i]! + ONSET_MARGIN && i - last >= minGap) {
      strengths[i] = Math.min(1, value)
      last = i
    }
  }
  return strengths
}

/**
 * Onsets in a live input, from its flux one hop at a time: the rule of
 * `detectOnsets` with the past only. The loud onsets' flux is the 99th
 * percentile of the last LIVE_ONSET_LOUD_SECONDS, never below
 * ONSET_FLUX_FLOOR, and an onset's strength is its flux against it, capped
 * at 1.
 */
export function createLiveOnsetDetector(): (
  timeSeconds: number,
  flux: number,
) => number {
  const pick = createCausalPicker({
    windowSeconds: ONSET_WINDOW_SECONDS,
    sigmas: 1.5,
    minGapSeconds: ONSET_MIN_GAP_SECONDS,
  })
  const history = createLevelHistogram(LIVE_ONSET_LOUD_SECONDS)
  return (timeSeconds, flux) => {
    history.add(timeSeconds, amplitudeToDb(flux))
    const loudDb = history.quantile(LOUD_ONSET_QUANTILE)
    const loud = Math.max(
      loudDb === undefined ? flux : 10 ** (loudDb / 20),
      ONSET_FLUX_FLOOR,
    )
    return pick(timeSeconds, flux, ONSET_MARGIN * loud)
      ? Math.min(1, flux / loud)
      : 0
  }
}
