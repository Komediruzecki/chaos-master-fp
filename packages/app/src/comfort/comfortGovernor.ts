// The comfort governor: a feed-forward limiter on audio-driven motion. Each
// modulated target slews toward its mapped value no faster than its preset
// allows; a brightness setting is also held to a peak-to-peak range inside any
// 500 ms, and zoom to one inside any 5 s. It caps parameters, not the
// luminance of the rendered frame.
import { MAX_CAMERA_ZOOM_VALUE, MIN_CAMERA_ZOOM_VALUE, numberDomainOf, RenderSettings, } from '@chaos-master/core'
import { COMFORT_CAPS } from './comfortPresets'
import type { ComfortCaps, ComfortPreset } from './comfortPresets'
import type { FlameTarget, RenderSettingKey, TransformPropertyKey, } from '@/utils/audioMapping'

/** A stalled tick (a background tab, a breakpoint) counts as this long at most. */
export const MAX_STEP_SECONDS = 0.1

/**
 * How long an output stays in a window past the window's length. Time is a
 * float sum of step lengths, so an output exactly one window old can read a
 * hair older than that and leave the window one step early, which lets the
 * next output go one step past the range. A microsecond is far above that
 * rounding and far below any frame.
 */
const WINDOW_SLACK_SECONDS = 1e-6

/** Floor for a transform probability, the one its writer holds it to. */
export const PROBABILITY_FLOOR = 1e-3

/**
 * A target moves in its `space`, held to `min` and `max`: linear, or log for
 * a setting that acts by ratio, where it moves in ln units and `min` is above
 * 0 (ln 0 has no slew). The bounds are what the renderer can show, the flame
 * schema's range for a render setting, so the governor never travels through
 * values the writer would clamp away: a row that asks past a bound turns
 * back the frame its music does.
 */
type Slew = { space: 'linear' | 'log'; min: number; max: number }

type ComfortRule =
  | { kind: 'free' }
  | { kind: 'wrap'; rate: number }
  | (Slew & {
      kind: 'slew'
      rate: number
      window?: { range: number; seconds: number }
    })

/** The render settings a slew rule governs. */
type SlewedSetting = Exclude<RenderSettingKey, 'palettePhase' | 'skipIters'>

/** A render setting in `space`, held to the range the flame schema gives it. */
function schemaSlew(param: SlewedSetting, space: Slew['space']): Slew {
  const domain =
    param === 'zoom'
      ? { min: MIN_CAMERA_ZOOM_VALUE, max: MAX_CAMERA_ZOOM_VALUE }
      : numberDomainOf(RenderSettings.entries[param])
  const slew: Slew = {
    space,
    min: domain?.min ?? -Infinity,
    max: domain?.max ?? Infinity,
  }
  if (space === 'log' && !(slew.min > 0)) {
    throw new Error(`${param} needs a positive schema minimum`)
  }
  return slew
}

const RENDER_SLEWS: Record<SlewedSetting, Slew> = {
  zoom: schemaSlew('zoom', 'log'),
  contrast: schemaSlew('contrast', 'log'),
  gamma: schemaSlew('gamma', 'log'),
  exposure: schemaSlew('exposure', 'linear'),
  vibrancy: schemaSlew('vibrancy', 'linear'),
  highlightPower: schemaSlew('highlightPower', 'linear'),
  lightPower: schemaSlew('lightPower', 'linear'),
  depthColorPower: schemaSlew('depthColorPower', 'linear'),
  paletteSpeed: schemaSlew('paletteSpeed', 'linear'),
}

const LINEAR: Slew = { space: 'linear', min: -Infinity, max: Infinity }
const PROBABILITY: Slew = {
  space: 'log',
  min: PROBABILITY_FLOOR,
  max: Infinity,
}

/**
 * A brightness setting, in the space where equal steps look equal on
 * screen. Exposure is already the log of a gain (the colour pass multiplies
 * by 2 exp(exposure)), so it moves linearly in ln-gain units and may be
 * negative. Vibrancy scales chroma and often rests at 0, like the three
 * powers. Contrast scales the tone-mapped density and gamma is its
 * exponent: those two act by ratio.
 */
function brightnessRule(slew: Slew, caps: ComfortCaps): ComfortRule {
  return {
    ...slew,
    kind: 'slew',
    rate: caps.brightnessRate,
    window: {
      range: caps.brightnessWindowRange,
      seconds: caps.brightnessWindowSeconds,
    },
  }
}

function renderRule(param: RenderSettingKey, caps: ComfortCaps): ComfortRule {
  switch (param) {
    case 'zoom':
      // A speed cap alone lets a slow breath swing as far as the row
      // reaches, so zoom is also held to a range inside any window.
      return {
        ...RENDER_SLEWS.zoom,
        kind: 'slew',
        rate: caps.zoomLogRate,
        window: {
          range: caps.zoomWindowRange,
          seconds: caps.zoomWindowSeconds,
        },
      }
    case 'palettePhase':
      return { kind: 'wrap', rate: caps.paletteTurnsPerSecond }
    case 'paletteSpeed':
      return {
        ...RENDER_SLEWS.paletteSpeed,
        kind: 'slew',
        rate: caps.paletteSpeedRate,
      }
    case 'skipIters':
      // Warm-up iterations change which points are plotted, not how fast
      // anything on screen moves.
      return { kind: 'free' }
    case 'contrast':
    case 'gamma':
    case 'exposure':
    case 'vibrancy':
    case 'highlightPower':
    case 'lightPower':
    case 'depthColorPower':
      return brightnessRule(RENDER_SLEWS[param], caps)
  }
}

function propertyRule(
  property: TransformPropertyKey,
  caps: ComfortCaps,
): ComfortRule {
  switch (property) {
    case 'probability':
      return { ...PROBABILITY, kind: 'slew', rate: caps.probabilityLogRate }
    case 'colorX':
    case 'colorY':
      return { ...LINEAR, kind: 'slew', rate: caps.colorRate }
    case 'colorSpeed':
      return { ...LINEAR, kind: 'slew', rate: caps.colorSpeedRate }
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
        ...LINEAR,
        kind: 'slew',
        rate: offset ? caps.affineOffsetRate : caps.affineLinearRate,
      }
    }
    case 'transformProperty':
      return propertyRule(target.property, caps)
    case 'variationWeight':
      return { ...LINEAR, kind: 'slew', rate: caps.variationWeightRate }
  }
}

type TargetState = {
  /** The last output, in the rule's coordinate (ln for log space). */
  y: number
  /** Seconds this target has been governed. */
  t: number
  /** Outputs inside the rule's window, oldest first. */
  history: { t: number; y: number }[]
}

/** The fractional part in [0, 1). `x - floor(x)` alone rounds -1e-17 up to 1. */
function fract(value: number): number {
  const f = value - Math.floor(value)
  return f >= 1 ? 0 : f
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** `value` held to a slew rule's bounds; other rules take it as it is. */
function held(rule: ComfortRule, value: number): number {
  return rule.kind === 'slew' ? clamp(value, rule.min, rule.max) : value
}

function toCoordinate(rule: ComfortRule, value: number): number {
  if (rule.kind === 'wrap') return fract(value)
  if (rule.kind === 'slew' && rule.space === 'log') {
    return Math.log(held(rule, value))
  }
  return held(rule, value)
}

function fromCoordinate(rule: ComfortRule, y: number): number {
  return rule.kind === 'slew' && rule.space === 'log' ? Math.exp(y) : y
}

/** Moves `state` one step of `h` seconds toward coordinate `u`. */
function advance(
  rule: ComfortRule,
  state: TargetState,
  u: number,
  h: number,
): void {
  // No time, no motion, and nothing new for a window that forgets outputs
  // by time.
  if (!(h > 0)) return
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
    // Every output at most `seconds` old stays, the one exactly that old too.
    const cutoff = state.t - seconds - WINDOW_SLACK_SECONDS
    while (state.history.length > 0 && state.history[0]!.t < cutoff) {
      state.history.shift()
    }
    // Every output still in the window bounds the next one from both sides,
    // so no two outputs inside any window are more than `range` apart.
    let lo = -Infinity
    let hi = Infinity
    for (const past of state.history) {
      lo = Math.max(lo, past.y - range)
      hi = Math.min(hi, past.y + range)
    }
    // The previous output is in the window, so the bounds hold it, and the
    // clamp only ever pulls the next one back toward it. After a switch to a
    // narrower preset the window can already span more than the new range:
    // then any move would widen a swing that is too wide already, so the
    // output holds until the older outputs have left.
    next = state.y >= lo && state.y <= hi ? clamp(next, lo, hi) : state.y
    state.history.push({ t: state.t, y: next })
  }
  state.y = next
}

export type ComfortGovernor = {
  preset(): ComfortPreset
  /**
   * Takes effect on the next step, from where every target is now. A window
   * keeps the outputs already in it and holds them to the new range, so a
   * switch inside a window cannot widen what the window shows.
   */
  setPreset(preset: ComfortPreset): void
  /**
   * The value to show for `target` this frame, given the value its mapping
   * asks for and the seconds since this target's previous step.
   *
   * `seed` is read once, on a target's first step: the value the flame shows
   * without modulation, so turning audio on eases in from the authored value
   * instead of cutting to the mapped one. Without a seed the first value
   * passes through.
   *
   * A value or seed past what the renderer can show, the schema's range for
   * a render setting or the writer's floor for a probability, is taken at
   * that bound, so a target asked past it turns back the frame it is asked
   * to.
   *
   * A non-finite `value` moves nothing: the target shows its last output,
   * or on a first step the seed, and the next finite value eases in from
   * there. Only with neither is there nothing finite to show, and the value
   * comes back as it came in. A `dt` that is not a positive number moves
   * nothing either.
   */
  step(
    target: FlameTarget,
    key: string,
    value: number,
    dt: number,
    seed?: () => number | undefined,
  ): number
  /** Forgets one target: its next step starts over. */
  forget(key: string): void
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
    },
    step(target, key, value, dt, seed) {
      const rule = comfortRule(target, COMFORT_CAPS[current])
      if (rule.kind === 'free') return value
      const state = states.get(key)
      if (!Number.isFinite(value)) {
        if (state) return fromCoordinate(rule, state.y)
        const authored = seed?.()
        return authored !== undefined && Number.isFinite(authored)
          ? held(rule, authored)
          : value
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
        return held(rule, value)
      }
      const y = toCoordinate(rule, authored)
      const fresh: TargetState = { y, t: 0, history: [{ t: 0, y }] }
      states.set(key, fresh)
      advance(rule, fresh, toCoordinate(rule, value), h)
      return fromCoordinate(rule, fresh.y)
    },
    forget(key) {
      states.delete(key)
    },
    reset() {
      states.clear()
    },
  }
}
