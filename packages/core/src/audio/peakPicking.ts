// Picking events out of a detection function: the frames where a flux rises
// above a threshold that follows the music, so a quiet passage keeps its
// beats after a loud one. Every window and gap is in seconds, converted at the
// caller's real frame rate.

/** How wide the window a beat's threshold is measured over is, in seconds. */
export const BEAT_WINDOW_SECONDS = 4

/** The least time between two beats, in seconds. */
export const BEAT_MIN_GAP_SECONDS = 0.1

/**
 * Mean plus `sigmas` standard deviations of `signal` over the `halfWidth`
 * values either side of each index, and fewer at the ends.
 */
export function centredThresholds(
  signal: ArrayLike<number>,
  halfWidth: number,
  sigmas: number,
): Float64Array {
  const n = signal.length
  const sum = new Float64Array(n + 1)
  const sumOfSquares = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const value = signal[i]!
    sum[i + 1] = sum[i]! + value
    sumOfSquares[i + 1] = sumOfSquares[i]! + value * value
  }
  const thresholds = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - halfWidth)
    const to = Math.min(n, i + halfWidth + 1)
    const count = to - from
    const mean = (sum[to]! - sum[from]!) / count
    const variance = Math.max(
      0,
      (sumOfSquares[to]! - sumOfSquares[from]!) / count - mean * mean,
    )
    thresholds[i] = mean + sigmas * Math.sqrt(variance)
  }
  return thresholds
}

/**
 * Beats in a whole file: the frames where the band flux peaks above the mean
 * + 1.5σ of the BEAT_WINDOW_SECONDS around it, at least BEAT_MIN_GAP_SECONDS
 * apart. A peak is a frame above the one before and not below the one after,
 * so a beat lands where the attack is, not a frame early where it starts.
 * `fps` is the analyzer's real frame rate.
 */
export function detectBeatFrames(
  flux: ArrayLike<number>,
  fps: number,
): Set<number> {
  const halfWidth = Math.max(1, Math.round((BEAT_WINDOW_SECONDS * fps) / 2))
  const thresholds = centredThresholds(flux, halfWidth, 1.5)
  const minGap = Math.max(1, Math.round(BEAT_MIN_GAP_SECONDS * fps))
  const beats = new Set<number>()
  let last = -Infinity
  for (let i = 1; i < flux.length; i++) {
    const value = flux[i]!
    const isPeak =
      value > flux[i - 1]! && (i + 1 === flux.length || value >= flux[i + 1]!)
    if (isPeak && value > thresholds[i]! && i - last >= minGap) {
      beats.add(i)
      last = i
    }
  }
  return beats
}
