// Band levels for audio-reactive mapping. A band's raw level, its mean FFT
// magnitude, is about 0.001 on real music, so a mapping driven by it barely
// moves. In decibels, against the range the band covers, it uses the whole of
// [0, 1]. A file is measured against its whole track, deterministically, so
// the live preview of a file and its export agree; a live input, which has no
// end to look ahead to, against the last 30 s of it, with its zero lifted by
// how far noise alone moves the band, so a quiet room reads 0.

import { createLevelHistogram } from './levelHistogram'

/** What digital silence reads as, in dB: log10(0) has no value. */
export const SILENT_DB = -200

/** How far below a band's loud end its zero may sit. Quieter reads 0. */
export const BAND_FLOOR_DB = 45

/** The least span a band is stretched over: a band that barely moves is not
 *  magnified into flicker, and a constant one does not divide by zero. */
export const MIN_BAND_SPAN_DB = 6

/** Where a band's zero sits among its levels: the 10th percentile, so a quiet
 *  passage reads 0. */
export const QUIET_QUANTILE = 0.1

/** Where a band's top sits among its levels: the 98th percentile, so a single
 *  transient is not what the rest is measured against. */
export const LOUD_QUANTILE = 0.98

/** An amplitude in decibels (20 log10), with silence held at SILENT_DB. */
export function amplitudeToDb(amplitude: number): number {
  return amplitude > 1e-10 ? 20 * Math.log10(amplitude) : SILENT_DB
}

/** The q-quantile of ascending values, interpolated between the two nearest
 *  ranks. 0 for no values. */
export function quantileOfSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length
  if (n === 0) return 0
  const at = Math.min(1, Math.max(0, q)) * (n - 1)
  const below = Math.floor(at)
  const above = Math.min(n - 1, below + 1)
  const low = sorted[below]!
  return low + (sorted[above]! - low) * (at - below)
}

/** The stretch of decibels one band covers: `floorDb` reads 0, and
 *  `floorDb + spanDb` reads 1. */
export type BandRange = { floorDb: number; spanDb: number }

/**
 * The range one band covers over a whole track. Its 10th percentile reads 0
 * and its 98th reads 1, except that the zero sits no more than BAND_FLOOR_DB
 * below the top, so a silent intro does not squash the music, and the span is
 * at least MIN_BAND_SPAN_DB. `quietLiftDb` raises the 10th percentile first:
 * the file's event gate lifts it by how far noise moves the band.
 */
export function trackBandRange(
  levelsDb: readonly number[],
  quietLiftDb = 0,
): BandRange {
  const sorted = [...levelsDb].sort((a, b) => a - b)
  return rangeBetween(
    quantileOfSorted(sorted, QUIET_QUANTILE) + quietLiftDb,
    quantileOfSorted(sorted, LOUD_QUANTILE),
  )
}

/** The range from a band's quiet level to its loud one: the zero at the
 *  quiet level, but no more than BAND_FLOOR_DB under the loud one, and a
 *  span of at least MIN_BAND_SPAN_DB. */
function rangeBetween(quietDb: number, loudDb: number): BandRange {
  const floorDb = Math.max(quietDb, loudDb - BAND_FLOOR_DB)
  return { floorDb, spanDb: Math.max(loudDb - floorDb, MIN_BAND_SPAN_DB) }
}

/** A level in decibels placed on [0, 1] within a band's range. */
export function bandLevel(levelDb: number, range: BandRange): number {
  return Math.min(1, Math.max(0, (levelDb - range.floorDb) / range.spanDb))
}

/**
 * Every band of every frame of a track on [0, 1], each band against its own
 * range over the whole track. `frames[i][b]` is band b's raw amplitude in
 * frame i.
 */
export function normalizeTrackBands(
  frames: readonly (readonly number[])[],
): number[][] {
  const bandCount = frames[0]?.length ?? 0
  const ranges = Array.from({ length: bandCount }, (_, b) =>
    trackBandRange(frames.map((frame) => amplitudeToDb(frame[b] ?? 0))),
  )
  return frames.map((frame) =>
    frame.map((amplitude, b) =>
      bandLevel(amplitudeToDb(amplitude), ranges[b]!),
    ),
  )
}

/**
 * How far, in dB, a band's level moves on steady noise alone, from its 10th
 * percentile to its 90th, when the band is the mean of `binCount` FFT bins.
 * The fewer the bins, the more the mean wobbles. Fitted as 16 / n^0.45, it
 * sits at or above the spread measured on white, pink and brown noise, FFTs
 * of 1024 to 4096 at 44.1 and 48 kHz: 14.6 dB for 1 bin, 11.1 for 2, 5.4 for
 * 9, 2.0 for 69 and 0.5 for 650. A band with no bins reads silence: 0.
 */
export function noiseWobbleDb(binCount: number): number {
  return binCount > 0 ? 16 / binCount ** 0.45 : 0
}

/** How far over its zero some band must stand, in dB, for a frame to hold a
 *  beat or an onset. With the zero lifted by `noiseWobbleDb`, steady noise
 *  stood at most 6.4 dB over it (white, pink and brown noise, FFTs of 1024
 *  to 4096 at 44.1 and 48 kHz), and 5.8 dB over ten minutes at the live
 *  FFT of 2048, so it does not get to 9. Music's live beats and onsets stood
 *  at least 15.9 dB over it, with noise 5 dB under the music and on a
 *  squashed master alike. */
export const EVENT_MIN_RISE_DB = 9

/** Whether a frame is audible: some band `riseDb` over its zero by at least
 *  EVENT_MIN_RISE_DB. Beats and onsets land only on audible frames. */
export function isAudible(riseDb: readonly number[]): boolean {
  return riseDb.some((rise) => rise >= EVENT_MIN_RISE_DB)
}

/**
 * Which frames of a track are audible (`isAudible`): each band measured
 * against its zero over the whole track, its quiet level lifted by
 * `noiseWobbleDb` of its bins, as the live zero is. `frames[i][b]` is band
 * b's raw amplitude in frame i, and `binCounts[b]` how many FFT bins band b
 * averages.
 */
export function trackAudibleFrames(
  frames: readonly (readonly number[])[],
  binCounts: readonly number[],
): boolean[] {
  const floorsDb = binCounts.map(
    (count, b) =>
      trackBandRange(
        frames.map((frame) => amplitudeToDb(frame[b] ?? 0)),
        noiseWobbleDb(count),
      ).floorDb,
  )
  return frames.map((frame) =>
    isAudible(
      floorsDb.map((floorDb, b) => amplitudeToDb(frame[b] ?? 0) - floorDb),
    ),
  )
}

/** How much audio a live band is measured against, in seconds. Long enough
 *  that a 50 ms burst is 0.2% of it, well inside the 2% the top ignores,
 *  and that the quiet level is the room's rather than a gap between notes;
 *  short enough to follow a set from its quiet start into its loud middle. */
export const LIVE_BAND_WINDOW_SECONDS = 30

/** How much audio a live band hears before its zero is its 10th percentile,
 *  in seconds. Until then the zero moves down from the median: a second of
 *  levels does not yet say where the quiet ones are, and a zero set too low
 *  would read the first second of a quiet room as sound. */
export const LIVE_BAND_SETTLE_SECONDS = 5

/** Live band levels, one call per analysed hop. */
export type LiveBandNormalizer = {
  /** The bands' amplitudes, heard at `timeSeconds` on the audio clock, as
   *  levels on [0, 1]. */
  levels(amplitudes: readonly number[], timeSeconds: number): number[]
  /** How far each band stood over its zero at the last call, in dB. */
  readonly riseDb: readonly number[]
}

/**
 * Band levels for a live input, a microphone: the rule of `trackBandRange`
 * over the last LIVE_BAND_WINDOW_SECONDS of each band, with the zero lifted
 * by `noiseWobbleDb` of the band's bins, so steady noise, which wobbles under
 * it, reads 0 at once and after music stops. `binCounts[b]` is how many FFT
 * bins band b averages. Each level counts for the audio time since the last
 * call, so the range does not depend on how often the input is polled.
 */
export function createLiveBandNormalizer(
  binCounts: readonly number[],
): LiveBandNormalizer {
  const histograms = binCounts.map(() =>
    createLevelHistogram(LIVE_BAND_WINDOW_SECONDS),
  )
  const wobblesDb = binCounts.map(noiseWobbleDb)
  const riseDb = binCounts.map(() => 0)
  return {
    riseDb,
    levels(amplitudes, timeSeconds) {
      return amplitudes.map((amplitude, b) => {
        const levelDb = amplitudeToDb(amplitude)
        const histogram = histograms[b]!
        histogram.add(timeSeconds, levelDb)
        const settled = Math.min(
          1,
          histogram.seconds() / LIVE_BAND_SETTLE_SECONDS,
        )
        const quietDb =
          histogram.quantile(0.5 + (QUIET_QUANTILE - 0.5) * settled) ?? levelDb
        const range = rangeBetween(
          quietDb + wobblesDb[b]!,
          histogram.quantile(LOUD_QUANTILE) ?? levelDb,
        )
        riseDb[b] = levelDb - range.floorDb
        return bandLevel(levelDb, range)
      })
    },
  }
}
