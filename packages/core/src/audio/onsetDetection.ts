// Onsets: the moments a sound starts, a drum hit, a pluck, a consonant. The
// detection function is the log spectral flux, how far the spectrum rose since
// the last frame on a log scale, so a hi-hat counts next to a kick. A frame is
// an onset where that flux peaks above a threshold that follows the music; its
// value is a strength on [0, 1], and 0 between onsets.

import { quantileOfSorted } from './bandNormalization'
import { centredThresholds } from './peakPicking'

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
 * ONSET_MIN_GAP_SECONDS after the last onset. Flux is measured against the
 * track's loud onsets, its 99th percentile, and an onset's strength is that
 * ratio capped at 1. `fps` is the analyzer's real frame rate.
 */
export function detectOnsets(
  flux: ArrayLike<number>,
  fps: number,
): Float32Array {
  const strengths = new Float32Array(flux.length)
  const loud = quantileOfSorted(Float64Array.from(flux).sort(), 0.99)
  const scale = Math.max(loud, ONSET_FLUX_FLOOR)
  const relative = Float64Array.from(flux, (value) => value / scale)
  const halfWidth = Math.max(1, Math.round((ONSET_WINDOW_SECONDS * fps) / 2))
  const thresholds = centredThresholds(relative, halfWidth, 1.5)
  const minGap = Math.max(1, Math.round(ONSET_MIN_GAP_SECONDS * fps))
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
