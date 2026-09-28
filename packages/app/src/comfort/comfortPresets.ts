// Comfort presets for audio-reactive motion: the per-second rate caps and the
// brightness window the comfort governor holds every modulated target to.
// Numbers follow the eye-comfort research (rules 2, 11, 15 and 19); they cap
// parameters, not measured luminance.

export const COMFORT_PRESETS = ['calm', 'standard', 'intense'] as const

export type ComfortPreset = (typeof COMFORT_PRESETS)[number]

export const COMFORT_PRESET_LABELS: Record<ComfortPreset, string> = {
  calm: 'Calm',
  standard: 'Standard',
  intense: 'Intense',
}

export const COMFORT_PRESET_DESCRIPTIONS: Record<ComfortPreset, string> = {
  calm: 'Slow, gentle motion. The default when your system asks for reduced motion.',
  standard:
    'Lively motion, with brightness swings held to a comfortable range.',
  intense: 'Fast motion for performance. Brightness still never flashes.',
}

/** Every rate is an absolute change per second of the target's own units. */
export type ComfortCaps = {
  /** |d ln zoom / dt|, e-folds per second (rule 11: 0.15 / 0.35 / 0.7). */
  zoomLogRate: number
  /**
   * Largest peak-to-peak swing of ln zoom inside any zoom window. Breathing
   * at 0.1-0.5 Hz may span 0.01 / 0.02 / 0.05 e-folds and a beat pulse
   * 0 / 0.03 / 0.06; each preset takes the stricter of its two, so Calm
   * holds zoom still (0), Standard allows 0.02 and Intense 0.05.
   */
  zoomWindowRange: number
  /** The zoom window: 5 s holds at least half a cycle of any breathing at 0.1 Hz or faster, so it sees the whole peak-to-peak swing. */
  zoomWindowSeconds: number
  /** palettePhase turns per second, wrap-aware (rule 19: 15 / 45 / 120 degrees per second). */
  paletteTurnsPerSecond: number
  /** paletteSpeed per second: the hue cap through the palette index's 0.298 gain at log density 1. */
  paletteSpeedRate: number
  /** Largest peak-to-peak swing of one brightness setting inside any window, in the units the renderer shows: exposure's own (already an ln gain), ln units for contrast and gamma, linear for vibrancy and the powers. */
  brightnessWindowRange: number
  /** The window the range is measured over (rule 2: 500 ms). */
  brightnessWindowSeconds: number
  /** Slew of a brightness setting per second, in the same units as the range. */
  brightnessRate: number
  /** Affine a, b, d, e per second: rule 15's rotation cap (3 / 10 / 25 degrees per second) in radians. */
  affineLinearRate: number
  /** Affine c, f per second, in world units: the zoom rates, so a pan is no faster than a zoom. */
  affineOffsetRate: number
  /** ln transform probability per second: the brightness slew, since a weight redistributes density. */
  probabilityLogRate: number
  /** Transform colour x and y per second: the hue cap at a chroma radius of 0.2, split over two axes. */
  colorRate: number
  /** Transform colorSpeed per second: a full sweep in 12 / 4 / 1.5 seconds. */
  colorSpeedRate: number
  /** Variation weight per second: the zoom rates, a weight reshapes the picture about as much. */
  variationWeightRate: number
}

const DEGREE = Math.PI / 180

function caps(
  hueDegrees: number,
  rotationDegrees: number,
  zoom: number,
  zoomWindow: number,
  window: number,
  brightness: number,
  colorSweepSeconds: number,
): ComfortCaps {
  const turns = hueDegrees / 360
  return {
    zoomLogRate: zoom,
    zoomWindowRange: zoomWindow,
    zoomWindowSeconds: 5,
    paletteTurnsPerSecond: turns,
    paletteSpeedRate: turns / 0.298,
    brightnessWindowRange: window,
    brightnessWindowSeconds: 0.5,
    brightnessRate: brightness,
    affineLinearRate: rotationDegrees * DEGREE,
    affineOffsetRate: zoom,
    probabilityLogRate: brightness,
    colorRate: (0.2 * hueDegrees * DEGREE) / Math.SQRT2,
    colorSpeedRate: 1 / colorSweepSeconds,
    variationWeightRate: zoom,
  }
}

export const COMFORT_CAPS: Record<ComfortPreset, ComfortCaps> = {
  calm: caps(15, 3, 0.15, 0, 0.1, 0.3, 12),
  standard: caps(45, 10, 0.35, 0.02, 0.18, 0.6, 4),
  intense: caps(120, 25, 0.7, 0.05, 0.35, 1.5, 1.5),
}
