// Picking events out of a detection function: the frames where a flux rises
// above a threshold that follows the music, so a quiet passage keeps its
// beats after a loud one. Every window and gap is in seconds: converted at a
// file's real frame rate, or measured on the clock a live input is heard on.

/** How wide the window a beat's threshold is measured over is, in seconds. */
export const BEAT_WINDOW_SECONDS = 4

/** The least time between two beats, in seconds. */
export const BEAT_MIN_GAP_SECONDS = 0.1

/**
 * The frames a gap of `seconds` takes at `fps`, rounded up and at least one,
 * so no two events land closer than the gap: 0.1 s is 3 frames at 24 fps,
 * not 2 (83 ms). A hair is taken off first, so an exact multiple such as
 * 0.1 s at 30 fps stays 3 frames despite float rounding.
 */
export function gapInFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.ceil(seconds * fps - 1e-9))
}

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
 * apart in whole frames (`gapInFrames`). A peak is a frame above the one
 * before and not below the one after, so a beat lands where the attack is,
 * not a frame early where it starts. `fps` is the analyzer's real frame rate.
 */
export function detectBeatFrames(
  flux: ArrayLike<number>,
  fps: number,
): Set<number> {
  const halfWidth = Math.max(1, Math.round((BEAT_WINDOW_SECONDS * fps) / 2))
  const thresholds = centredThresholds(flux, halfWidth, 1.5)
  const minGap = gapInFrames(BEAT_MIN_GAP_SECONDS, fps)
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

/** The shape of a live picker: how far back it looks, how high above the
 *  mean it sets the bar, and how soon it may fire again, all in seconds. */
export type CausalPickerOptions = {
  windowSeconds: number
  sigmas: number
  minGapSeconds: number
}

/**
 * Picks events from values arriving live, one at a time, each with the time
 * it was heard. A value is an event when it rises above the value before it
 * and clears, by `margin`, the mean + `sigmas`·σ of the values of the last
 * `windowSeconds`, itself included (a live input has no future to centre on),
 * at least `minGapSeconds` after the last event.
 */
export function createCausalPicker(
  options: CausalPickerOptions,
): (timeSeconds: number, value: number, margin?: number) => boolean {
  const history: { time: number; value: number }[] = []
  let previous = 0
  let lastEvent = -Infinity
  return (timeSeconds, value, margin = 0) => {
    history.push({ time: timeSeconds, value })
    while (history[0]!.time < timeSeconds - options.windowSeconds) {
      history.shift()
    }
    let sum = 0
    let sumOfSquares = 0
    for (const entry of history) {
      sum += entry.value
      sumOfSquares += entry.value * entry.value
    }
    const mean = sum / history.length
    const deviation = Math.sqrt(
      Math.max(0, sumOfSquares / history.length - mean * mean),
    )
    const isEvent =
      value > previous &&
      value > mean + options.sigmas * deviation + margin &&
      // A hair under the gap, so float rounding of the clock never drops one.
      timeSeconds - lastEvent >= options.minGapSeconds - 1e-9
    previous = value
    if (isEvent) lastEvent = timeSeconds
    return isEvent
  }
}

/**
 * Beats in a live input: its band flux, one hop at a time, rising above the
 * mean + 1.5σ of the past half of a file's window (BEAT_WINDOW_SECONDS / 2),
 * at least BEAT_MIN_GAP_SECONDS apart.
 */
export function createLiveBeatDetector(): (
  timeSeconds: number,
  flux: number,
) => boolean {
  const pick = createCausalPicker({
    windowSeconds: BEAT_WINDOW_SECONDS / 2,
    sigmas: 1.5,
    minGapSeconds: BEAT_MIN_GAP_SECONDS,
  })
  return (timeSeconds, flux) => pick(timeSeconds, flux)
}
