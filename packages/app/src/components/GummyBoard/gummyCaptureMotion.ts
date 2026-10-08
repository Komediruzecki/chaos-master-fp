/** Validated physical capture motion shared by recipes, saved matches and the shot driver. */
export type GummyBoardShotMotion = {
  /** Fraction of the crush and pause before the sweep: zero starts at descent, one preserves the original timing. */
  shearOnset: number
  /** Sideways travel in local piece units, scaled with the actors. */
  shearDistance: number
  /** Seconds held halfway through the downward press; missing preserves older recipes. */
  contactHold?: number
  /** Signed sweep direction; absent preserves the original forward sweep. */
  shearSign?: -1 | 1
  /** Peak alternating yaw in radians; absent preserves translation-only recipes. */
  twistAngle?: number
}

export const GUMMY_BOARD_ORIGINAL_MOTION: Readonly<GummyBoardShotMotion> =
  Object.freeze({ shearOnset: 1, shearDistance: 0.18, contactHold: 0 })
export const GUMMY_BOARD_EARLY_SHEAR_MOTION: Readonly<GummyBoardShotMotion> =
  Object.freeze({ shearOnset: 0.35, shearDistance: 1.1, contactHold: 0.35 })
export const GUMMY_BOARD_MOTION_RANGES = {
  shearOnset: { min: 0, max: 1 },
  shearDistance: { min: 0, max: 1.2 },
  contactHold: { min: 0, max: 0.6 },
  twistAngle: { min: 0, max: 0.35 },
} as const

function boundedMotionValue(
  value: unknown,
  key: keyof typeof GUMMY_BOARD_MOTION_RANGES,
  message: string,
) {
  const { min, max } = GUMMY_BOARD_MOTION_RANGES[key]
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(message)
  return value
}

export function resolveGummyBoardShotMotion(
  value: unknown = GUMMY_BOARD_ORIGINAL_MOTION,
): GummyBoardShotMotion & { contactHold: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Shot motion needs a shear onset and distance.')
  const motion = value as Record<string, unknown>
  const shearOnset = boundedMotionValue(
    motion.shearOnset,
    'shearOnset',
    'Shear onset must be between 0 and 1.',
  )
  const shearDistance = boundedMotionValue(
    motion.shearDistance,
    'shearDistance',
    'Shear distance must be between 0 and 1.2.',
  )
  const contactHold = boundedMotionValue(
    motion.contactHold === undefined ? 0 : motion.contactHold,
    'contactHold',
    'The mid-press hold must be between 0 and 0.6 seconds.',
  )
  if (
    motion.shearSign !== undefined &&
    motion.shearSign !== -1 &&
    motion.shearSign !== 1
  )
    throw new Error('Sweep direction must be -1 or 1.')
  const twistAngle =
    motion.twistAngle === undefined
      ? undefined
      : boundedMotionValue(
          motion.twistAngle,
          'twistAngle',
          'Rock angle must be between 0 and 0.35 radians.',
        )
  return {
    ...(motion.shearSign === undefined ? {} : { shearSign: motion.shearSign }),
    ...(twistAngle === undefined ? {} : { twistAngle }),
    shearOnset,
    shearDistance,
    contactHold,
  }
}
