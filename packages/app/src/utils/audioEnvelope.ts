// The attack and release a mapping row runs at, and the longest ones the
// wiring editor's sliders reach. One definition, shared by the envelope in
// utils/audioMapping.ts and every place that shows the times.

/** The two envelope fields of a mapping row (`AudioMappingEntry`). Declared
 *  here, not imported, because the mapping stage imports this module. */
type EnvelopeTimes = { attackMs?: number; releaseMs?: number }

/** A three-second swell. Longer times still load and run; the slider grows. */
export const ATTACK_MAX_MS = 3000
/** A six-second fade. Longer times still load and run; the slider grows. */
export const RELEASE_MAX_MS = 6000

/**
 * The times the envelope uses. An unset time follows the other one, so a row
 * that sets only a release rises at that release too; with neither set the
 * value moves at once. An explicit 0 is instant, not unset.
 */
export function effectiveEnvelope(entry: EnvelopeTimes): {
  attackMs: number
  releaseMs: number
} {
  return {
    attackMs: entry.attackMs ?? entry.releaseMs ?? 0,
    releaseMs: entry.releaseMs ?? entry.attackMs ?? 0,
  }
}

/** What a panel row says about its envelope. */
export function envelopeLabel(entry: EnvelopeTimes): string {
  const { attackMs, releaseMs } = effectiveEnvelope(entry)
  return `Attack ${attackMs} ms · Release ${releaseMs} ms`
}
