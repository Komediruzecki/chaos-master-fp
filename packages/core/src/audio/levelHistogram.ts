// A running histogram of levels in decibels over the last stretch of audio
// time. Its quantiles cost the same however long the window is, and each
// level counts for the audio time since the one before it, so how often a live
// input is polled does not move them. The live band levels, onsets and beats
// take their quiet and loud references from one.

/** How fine a level is held, in dB: finer than a level can be heard to move. */
export const LEVEL_BIN_DB = 0.5

/** The most audio time one level stands for, in seconds, so a caller that
 *  stalls, a hidden tab's timer, does not make one level a long stretch. */
export const MAX_LEVEL_SECONDS = 0.1

/** The levels the bins cover, in dB: from digital silence, which
 *  `amplitudeToDb` reads as -200, to 40 dB over full scale. A level outside
 *  is held in the bin at that end. */
const LOWEST_DB = -200
const HIGHEST_DB = 40

/** Levels over a window of audio time that slides with the input. */
export type LevelHistogram = {
  /** Adds `levelDb`, heard at `timeSeconds` on the audio clock, for the audio
   *  time since the last one added (none for the first), and forgets what is
   *  older than the window. */
  add(timeSeconds: number, levelDb: number): void
  /** The q-quantile of the levels held, interpolated within its bin by
   *  weight; undefined while nothing is held. */
  quantile(q: number): number | undefined
  /** The seconds of audio held. */
  seconds(): number
}

/** A level histogram over the last `windowSeconds` of audio time. */
export function createLevelHistogram(windowSeconds: number): LevelHistogram {
  const binCount = Math.ceil((HIGHEST_DB - LOWEST_DB) / LEVEL_BIN_DB)
  // Weights in whole microseconds, so taking one back out is exact.
  const weights = new Float64Array(binCount)
  let total = 0
  const held: { time: number; bin: number; weight: number }[] = []
  let oldest = 0
  let lastTime: number | undefined

  const forgetBefore = (time: number) => {
    while (oldest < held.length && held[oldest]!.time < time) {
      const { bin, weight } = held[oldest]!
      weights[bin] = weights[bin]! - weight
      total -= weight
      oldest++
    }
    if (oldest > 1024 && oldest * 2 > held.length) {
      held.splice(0, oldest)
      oldest = 0
    }
  }

  return {
    add(timeSeconds, levelDb) {
      const seconds =
        lastTime === undefined
          ? 0
          : Math.min(MAX_LEVEL_SECONDS, Math.max(0, timeSeconds - lastTime))
      lastTime = timeSeconds
      forgetBefore(timeSeconds - windowSeconds)
      const weight = Math.round(seconds * 1e6)
      if (weight === 0) return
      // NaN compares false, so it lands with silence.
      const clamped =
        levelDb > LOWEST_DB ? Math.min(levelDb, HIGHEST_DB) : LOWEST_DB
      const bin = Math.min(
        binCount - 1,
        Math.floor((clamped - LOWEST_DB) / LEVEL_BIN_DB),
      )
      weights[bin] = weights[bin]! + weight
      total += weight
      held.push({ time: timeSeconds, bin, weight })
    },
    quantile(q) {
      if (total === 0) return undefined
      const target = Math.min(1, Math.max(0, q)) * total
      let below = 0
      for (let bin = 0; bin < binCount; bin++) {
        const weight = weights[bin]!
        if (weight === 0) continue
        if (below + weight >= target) {
          return LOWEST_DB + (bin + (target - below) / weight) * LEVEL_BIN_DB
        }
        below += weight
      }
      return HIGHEST_DB
    },
    seconds: () => total / 1e6,
  }
}
