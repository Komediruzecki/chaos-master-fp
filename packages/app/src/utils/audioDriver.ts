import type { AudioFeature, FrameData } from './audioAnalysis'
import { clamp } from './easing'

// ── Types (mirrored in flame/schema/timeline.ts — kept in sync) ──────────

/** Per-track audio driver that modulates a resolved keyframe value. */
export interface AudioDriver {
  /** Which audio feature drives this channel. */
  feature: AudioFeature
  /** How the feature modulates the resolved value. */
  mode: 'multiply' | 'add' | 'replace'
  /** Scaling factor applied to the normalised feature (0–1). */
  sensitivity: number
  /** Output clamp range as [min, max]. */
  range: [number, number]
  /** Attack smoothing in ms — how fast the value rises (0 = instant). */
  attackMs?: number
  /** Release smoothing in ms — how fast the value falls (0 = instant). */
  releaseMs?: number
}

// ── Driver application ───────────────────────────────────────────────────

/**
 * Apply an audio driver to a resolved keyframe value.
 *
 * `featureNorm` is the normalised audio feature (0–1) for the current frame,
 * obtained via `getAudioFeatureNormalized(frameData, driver.feature)`.
 *
 * Modes:
 * - `multiply`: value × (1 + featureNorm × sensitivity)    — intensity/scale
 * - `add`:      value + featureNorm × sensitivity × span    — offset/position
 * - `replace`:  lerp(value, featureNorm, sensitivity)       — full takeover
 *
 * Returns `value` unchanged when `driver` is undefined/null (the no-driver case).
 */
export function applyAudioDriver(
  value: number,
  driver: AudioDriver | undefined,
  featureNorm: number,
): number {
  if (!driver || driver.sensitivity === 0) return value

  const s = clamp(driver.sensitivity, 0, 10)
  const fn = clamp(featureNorm, 0, 1)
  const [lo, hi] = driver.range
  const span = hi - lo

  let modulated: number

  switch (driver.mode) {
    case 'multiply':
      modulated = value * (1 + fn * s)
      break
    case 'add':
      modulated = value + fn * s * span
      break
    case 'replace':
      modulated = value + (fn - value) * s
      break
  }

  return clamp(modulated, lo, hi)
}

// ── Smoothing (attack/release envelope) ──────────────────────────────────

/**
 * Per-driver smoothing state: tracks the last output value so the envelope can
 * rise/fall at different rates. Callers keep one `DriverSmoothingState` per
 * active driver, keyed by track path.
 */
export interface DriverSmoothingState {
  lastOutput: number
}

/**
 * Apply attack/release smoothing to a newly-computed driver output.
 *
 * `dt` is the time delta in seconds since the last update (1/fps for timeline
 * playback; 1/60 or 1/30 for live). Returns `newValue` immediately when
 * attack/release are both zero.
 */
export function smoothDriverOutput(
  state: DriverSmoothingState,
  newValue: number,
  dt: number,
  attackMs: number,
  releaseMs: number,
): number {
  if (attackMs <= 0 && releaseMs <= 0) {
    state.lastOutput = newValue
    return newValue
  }

  const diff = newValue - state.lastOutput
  const tau =
    diff > 0
      ? Math.max(attackMs, 0.001) / 1000 // attack: rising
      : Math.max(releaseMs, 0.001) / 1000 // release: falling

  // Exponential moving average: output += (target - output) * (1 - exp(-dt/tau))
  const alpha = 1 - Math.exp(-dt / Math.max(tau, 0.0001))
  const smoothed = state.lastOutput + diff * alpha

  state.lastOutput = smoothed
  return smoothed
}
