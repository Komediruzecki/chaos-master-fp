// Band levels for audio-reactive mapping. A band's raw level, its mean FFT
// magnitude, is about 0.001 on real music, so a mapping driven by it barely
// moves. In decibels, against the range the band covers, it uses the whole of
// [0, 1]. A file is measured against its whole track, deterministically, so
// the live preview of a file and its export agree; a live input, which has no
// end to look ahead to, against a peak that follows each band.

/** What digital silence reads as, in dB: log10(0) has no value. */
export const SILENT_DB = -200

/** How far below a band's loud end its zero may sit. Quieter reads 0. */
export const BAND_FLOOR_DB = 45

/** The least span a band is stretched over: a band that barely moves is not
 *  magnified into flicker, and a constant one does not divide by zero. */
export const MIN_BAND_SPAN_DB = 6

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
 * at least MIN_BAND_SPAN_DB.
 */
export function trackBandRange(levelsDb: readonly number[]): BandRange {
  const sorted = [...levelsDb].sort((a, b) => a - b)
  const top = quantileOfSorted(sorted, 0.98)
  const floorDb = Math.max(quantileOfSorted(sorted, 0.1), top - BAND_FLOOR_DB)
  return { floorDb, spanDb: Math.max(top - floorDb, MIN_BAND_SPAN_DB) }
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

/** How long a live band's peak takes to fall by a factor of e, 8.7 dB, once
 *  the music gets quieter, in seconds. */
export const PEAK_RELEASE_SECONDS = 30

/** The lowest a live band's peak falls to, so digital silence reads 0. */
export const MIN_PEAK_DB = -100

/** Live band levels, one call per analysed hop. */
export type BandPeakNormalizer = {
  /** Band amplitudes to levels on [0, 1], `dtSeconds` after the last call. */
  levels(amplitudes: readonly number[], dtSeconds: number): number[]
}

/**
 * Band levels for a live input, a microphone. Each band follows its own
 * peak, up at once and down by PEAK_RELEASE_SECONDS, never below MIN_PEAK_DB.
 * A level reads 1 at the peak and 0 BAND_FLOOR_DB below it.
 */
export function createBandPeakNormalizer(): BandPeakNormalizer {
  const releaseDbPerSecond = (20 * Math.log10(Math.E)) / PEAK_RELEASE_SECONDS
  const peaksDb: number[] = []
  return {
    levels(amplitudes, dtSeconds) {
      const fall = releaseDbPerSecond * Math.max(0, dtSeconds)
      return amplitudes.map((amplitude, b) => {
        const levelDb = amplitudeToDb(amplitude)
        const peakDb = Math.max(
          levelDb,
          (peaksDb[b] ?? MIN_PEAK_DB) - fall,
          MIN_PEAK_DB,
        )
        peaksDb[b] = peakDb
        return bandLevel(levelDb, {
          floorDb: peakDb - BAND_FLOOR_DB,
          spanDb: BAND_FLOOR_DB,
        })
      })
    },
  }
}
