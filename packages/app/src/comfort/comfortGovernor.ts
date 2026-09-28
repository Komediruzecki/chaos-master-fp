// The comfort governor: a feed-forward limiter on audio-driven motion. Each
// modulated target slews toward its mapped value no faster than its preset
// allows, and a brightness setting is also held to a peak-to-peak range inside
// any window. It caps parameters, not the luminance of the rendered frame.
import { COMFORT_CAPS } from './comfortPresets'
import type { ComfortCaps, ComfortPreset } from './comfortPresets'
import type { FlameTarget, RenderSettingKey, TransformPropertyKey, } from '@/utils/audioMapping'

/** A stalled tick (a background tab, a breakpoint) counts as this long at most. */
export const MAX_STEP_SECONDS = 0.1

/** Floor for the log-space settings: ln(0) has no slew. */
export const LOG_FLOOR = 1e-3

type Space = 'linear' | 'log'

type ComfortRule =
  | { kind: 'free' }
  | { kind: 'wrap'; rate: number }
  | {
      kind: 'slew'
      space: Space
      rate: number
      window?: { range: number; seconds: number }
    }

const LOG_BRIGHTNESS: ReadonlySet<RenderSettingKey> = new Set([
  'exposure',
  'contrast',
  'gamma',
  'vibrancy',
])

function renderRule(param: RenderSettingKey, caps: ComfortCaps): ComfortRule {
  switch (param) {
    case 'zoom':
      return { kind: 'slew', space: 'log', rate: caps.zoomLogRate }
    case 'palettePhase':
      return { kind: 'wrap', rate: caps.paletteTurnsPerSecond }
    case 'paletteSpeed':
      return { kind: 'slew', space: 'linear', rate: caps.paletteSpeedRate }
    case 'skipIters':
      // Warm-up iterations change which points are plotted, not how fast
      // anything on screen moves.
      return { kind: 'free' }
    default:
      return {
        kind: 'slew',
        space: LOG_BRIGHTNESS.has(param) ? 'log' : 'linear',
        rate: caps.brightnessRate,
        window: {
          range: caps.brightnessWindowRange,
          seconds: caps.brightnessWindowSeconds,
        },
      }
  }
}

function propertyRule(
  property: TransformPropertyKey,
  caps: ComfortCaps,
): ComfortRule {
  switch (property) {
    case 'probability':
      return { kind: 'slew', space: 'log', rate: caps.probabilityLogRate }
    case 'colorX':
    case 'colorY':
      return { kind: 'slew', space: 'linear', rate: caps.colorRate }
    case 'colorSpeed':
      return { kind: 'slew', space: 'linear', rate: caps.colorSpeedRate }
  }
}

function comfortRule(target: FlameTarget, caps: ComfortCaps): ComfortRule {
  switch (target.kind) {
    case 'renderSetting':
      return renderRule(target.param, caps)
    case 'transformAffine':
    case 'finalAffine': {
      const offset = target.param === 'c' || target.param === 'f'
      return {
        kind: 'slew',
        space: 'linear',
        rate: offset ? caps.affineOffsetRate : caps.affineLinearRate,
      }
    }
    case 'transformProperty':
      return propertyRule(target.property, caps)
    case 'variationWeight':
      return { kind: 'slew', space: 'linear', rate: caps.variationWeightRate }
  }
}

type TargetState = {
  /** The last output, in the rule's coordinate (ln for log space). */
  y: number
  /** Seconds this target has been governed. */
  t: number
  /** Outputs inside the brightness window, oldest first. */
  history: { t: number; y: number }[]
}

/** The fractional part in [0, 1). `x - floor(x)` alone rounds -1e-17 up to 1. */
function fract(value: number): number {
  const f = value - Math.floor(value)
  return f >= 1 ? 0 : f
}

function toCoordinate(rule: ComfortRule, value: number): number {
  if (rule.kind === 'wrap') return fract(value)
  if (rule.kind === 'slew' && rule.space === 'log') {
    return Math.log(Math.max(value, LOG_FLOOR))
  }
  return value
}

function fromCoordinate(rule: ComfortRule, y: number): number {
  return rule.kind === 'slew' && rule.space === 'log' ? Math.exp(y) : y
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** Moves `state` one step of `h` seconds toward coordinate `u`. */
function advance(
  rule: ComfortRule,
  state: TargetState,
  u: number,
  h: number,
): void {
  state.t += h
  if (rule.kind === 'wrap') {
    // The shortest signed turn, in [-0.5, 0.5).
    const turn = ((((u - state.y) % 1) + 1.5) % 1) - 0.5
    state.y = fract(state.y + clamp(turn, -rule.rate * h, rule.rate * h))
    return
  }
  if (rule.kind !== 'slew') return
  const limit = rule.rate * h
  let next = state.y + clamp(u - state.y, -limit, limit)
  if (rule.window) {
    const { range, seconds } = rule.window
    const cutoff = state.t - seconds
    while (state.history.length > 0 && state.history[0]!.t < cutoff) {
      state.history.shift()
    }
    // Every output still in the window bounds the next one from both sides,
    // so no two outputs inside any window are more than `range` apart. The
    // previous output is in the window, so the bounds always hold it.
    let lo = -Infinity
    let hi = Infinity
    for (const past of state.history) {
      lo = Math.max(lo, past.y - range)
      hi = Math.min(hi, past.y + range)
    }
    next = clamp(next, lo, hi)
    state.history.push({ t: state.t, y: next })
  }
  state.y = next
}

export type ComfortGovernor = {
  preset(): ComfortPreset
  /** Takes effect on the next step, from where every target is now. */
  setPreset(preset: ComfortPreset): void
  /**
   * The value to show for `target` this frame, given the value its mapping
   * asks for and the seconds since this target's previous step.
   *
   * `seed` is read once, on a target's first step: the value the flame shows
   * without modulation, so turning audio on eases in from the authored value
   * instead of cutting to the mapped one. Without a seed the first value
   * passes through.
   */
  step(
    target: FlameTarget,
    key: string,
    value: number,
    dt: number,
    seed?: () => number | undefined,
  ): number
  /** Forgets every target: the next step of each starts over. */
  reset(): void
}

export function createComfortGovernor(initial: ComfortPreset): ComfortGovernor {
  let current = initial
  const states = new Map<string, TargetState>()

  return {
    preset: () => current,
    setPreset(preset) {
      current = preset
      for (const state of states.values()) {
        state.history = [{ t: state.t, y: state.y }]
      }
    },
    step(target, key, value, dt, seed) {
      const rule = comfortRule(target, COMFORT_CAPS[current])
      if (rule.kind === 'free') return value
      const state = states.get(key)
      if (!Number.isFinite(value)) {
        return state ? fromCoordinate(rule, state.y) : value
      }
      const h = clamp(Number.isFinite(dt) ? dt : 0, 0, MAX_STEP_SECONDS)
      if (state) {
        advance(rule, state, toCoordinate(rule, value), h)
        return fromCoordinate(rule, state.y)
      }
      const authored = seed?.()
      if (authored === undefined || !Number.isFinite(authored)) {
        const y = toCoordinate(rule, value)
        states.set(key, { y, t: 0, history: [{ t: 0, y }] })
        return value
      }
      const y = toCoordinate(rule, authored)
      const fresh: TargetState = { y, t: 0, history: [{ t: 0, y }] }
      states.set(key, fresh)
      advance(rule, fresh, toCoordinate(rule, value), h)
      return fromCoordinate(rule, fresh.y)
    },
    reset() {
      states.clear()
    },
  }
}
