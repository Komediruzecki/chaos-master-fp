/** Bounded live controls for particle jelly; defaults retain the calibrated material and timestep. */
export type GummyParticleTuning = {
  /** Multiplier on grip spring stiffness; damping follows its square root. */
  grabStrength: number
  /** Warm material relaxation multiplier: zero retains shape memory. */
  flow: number
  /** Downward acceleration as a multiple of terrestrial gravity. */
  gravity: number
  /** Warm floor tangential velocity decay rate, in inverse seconds. */
  floorDrag: number
  /** Warm viscosity multiplier, bounded by the existing diffusion limit. */
  viscosity: number
}

export const DEFAULT_GUMMY_PARTICLE_TUNING: Readonly<GummyParticleTuning> =
  Object.freeze({
    grabStrength: 1,
    flow: 1,
    gravity: 1,
    floorDrag: 5,
    viscosity: 1,
  })

export const GUMMY_PARTICLE_TUNING_RANGES = {
  grabStrength: { min: 0.1, max: 1 },
  flow: { min: 0, max: 1 },
  gravity: { min: 0, max: 1.5 },
  floorDrag: { min: 0, max: 12 },
  viscosity: { min: 0, max: 1 },
} as const

export function normalizeGummyParticleTuning(
  input: Partial<GummyParticleTuning> = {},
): GummyParticleTuning {
  const bounded = (key: keyof GummyParticleTuning) => {
    const value = input[key]
    const range = GUMMY_PARTICLE_TUNING_RANGES[key]
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(range.min, Math.min(range.max, value))
      : DEFAULT_GUMMY_PARTICLE_TUNING[key]
  }
  return {
    grabStrength: bounded('grabStrength'),
    flow: bounded('flow'),
    gravity: bounded('gravity'),
    floorDrag: bounded('floorDrag'),
    viscosity: bounded('viscosity'),
  }
}
