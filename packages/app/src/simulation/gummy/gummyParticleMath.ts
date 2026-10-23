/** Objective continuum stress and quadratic MLS transfers for the separate particle jelly study. */
import { d, std } from 'typegpu'
import { sampleGummyParticleFixture } from './gummyParticleFixtures'
import { normalizeGummyParticleTuning } from './gummyParticleTuning'
import type { GummyParticleFixtureOptions } from './gummyParticleFixtures'
import type { GummyParticleTuning } from './gummyParticleTuning'

export {
  DEFAULT_GUMMY_PARTICLE_TUNING,
  GUMMY_PARTICLE_TUNING_RANGES,
  normalizeGummyParticleTuning,
} from './gummyParticleTuning'
export type { GummyParticleTuning } from './gummyParticleTuning'

export const GUMMY_PARTICLE_OUTER_DT = 1 / 120
export const GUMMY_PARTICLE_GRID_SIZE = 48
export const GUMMY_PARTICLE_MAX_SPEED = 32
export const GUMMY_PARTICLE_MAX_AFFINE = 60
export const GUMMY_PARTICLE_MAX_F_NORM = 6
export const GUMMY_PARTICLE_MIN_J = 0.2
export const GUMMY_PARTICLE_MAX_J = 5
export const GUMMY_PARTICLE_MAX_SHEAR = 350
export const GUMMY_PARTICLE_BULK = 800
export const GUMMY_PARTICLE_MAX_VISCOSITY = 1
/** Stylized intact tensile yield: up to 35% elastic volume expansion before void opening. */
export const GUMMY_PARTICLE_CAVITATION_LOG_YIELD = Math.log(1.35)
export type GummyParticleMaterialMode = 'elastic' | 'warm'

export function gummyParticleMaterial(
  softness: number,
  mode: GummyParticleMaterialMode = 'elastic',
  fragility = 0.75,
  tuning?: Partial<GummyParticleTuning>,
) {
  const controls = normalizeGummyParticleTuning(tuning)
  const s = Number.isFinite(softness) ? Math.max(0, Math.min(1, softness)) : 0.5
  const fragile = Number.isFinite(fragility)
    ? Math.max(0, Math.min(1, fragility))
    : 0.75
  const warm = mode === 'warm'
  return {
    mode,
    shearModulus: GUMMY_PARTICLE_MAX_SHEAR * 0.35 ** s * (warm ? 0.7 : 1),
    bulkModulus: GUMMY_PARTICLE_BULK,
    density: 1,
    relaxationRate: warm ? (7 + 7 * s) * controls.flow : 0,
    damageRate: warm ? 12 + 12 * fragile : 0,
    viscosity: warm ? GUMMY_PARTICLE_MAX_VISCOSITY * controls.viscosity : 0,
    yieldStretch: 1.16 - 0.08 * fragile,
    damageOnset: 1.3 - 0.16 * fragile,
    damageComplete: 1.8 - 0.4 * fragile,
    gripStiffness: (warm ? 2400 : 4000) * controls.grabStrength,
    gripDamping: (warm ? 90 : 80) * Math.sqrt(controls.grabStrength),
    gravity: 9.81 * controls.gravity,
    floorDrag: controls.floorDrag,
  }
}

/** Largest acoustic eigenvalue for compressible NH, bounded over every admitted elastic state. */
export function gummyParticleWaveSpeed() {
  return Math.sqrt(
    GUMMY_PARTICLE_MAX_SHEAR * (GUMMY_PARTICLE_MAX_F_NORM ** 2 + 1) +
      GUMMY_PARTICLE_BULK * (1 - Math.log(GUMMY_PARTICLE_MIN_J)),
  )
}

/** Convex nodal momentum average bounds APIC/stress extrapolation separately from advection. */
export const gummyParticleGridSpeedLimit = (
  dt: number,
  dx: number,
  gravity: number,
) => {
  'use gpu'
  // Explicit std operations also execute on CPU; production strips implicit-operator helpers.
  const radius = std.mul(2.598076211353316, dx)
  // ||FF^T-I||_F <= ||F||_F^2 + sqrt(3), including every admitted J and damage.
  const stressBound = std.add(
    std.mul(
      GUMMY_PARTICLE_MAX_SHEAR,
      std.add(
        std.mul(GUMMY_PARTICLE_MAX_F_NORM, GUMMY_PARTICLE_MAX_F_NORM),
        1.7320508075688772,
      ),
    ),
    std.mul(
      std.mul(GUMMY_PARTICLE_BULK, 1.7320508075688772),
      1.6094379124341003,
    ),
  )
  const stressVelocity = std.div(
    std.mul(std.mul(std.mul(4, dt), stressBound), radius),
    std.mul(dx, dx),
  )
  const transferSpeed = std.add(
    std.add(
      GUMMY_PARTICLE_MAX_SPEED,
      std.mul(GUMMY_PARTICLE_MAX_AFFINE, radius),
    ),
    stressVelocity,
  )
  // Gravity adds g*dt; a prescribed platen can impose at most 2 units/s.
  return std.add(std.add(transferSpeed, std.mul(gravity, dt)), 2)
}

/** Equal-volume samples of the actual mould; no pre-cut regions or fragment labels. */
export function prepareGummyParticles(
  options: GummyParticleFixtureOptions = {},
) {
  const { spacing, points, pinHeight } = sampleGummyParticleFixture(options)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let id = 0; id < points.length; id += 4)
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, points[id + axis]!)
      max[axis] = Math.max(max[axis]!, points[id + axis]!)
    }
  const gridSpacing = spacing * 2
  const waveSpeed = gummyParticleWaveSpeed()
  const substeps = Math.ceil(
    (GUMMY_PARTICLE_OUTER_DT * (waveSpeed + GUMMY_PARTICLE_MAX_SPEED)) /
      (0.28 * gridSpacing),
  )
  const particleCount = points.length / 4
  const restVolume = particleCount * spacing ** 3
  const fixedDt = GUMMY_PARTICLE_OUTER_DT / substeps
  return {
    restPositions: new Float32Array(points),
    particleCount,
    spacing,
    gridSpacing,
    substeps,
    fixedDt,
    waveSpeedBound: waveSpeed,
    nodalSpeedBound: gummyParticleGridSpeedLimit(fixedDt, gridSpacing, 9.81),
    particleVolume: spacing ** 3,
    restVolume,
    pinHeight,
    bounds: { min, max },
    gridOrigin: [
      -24 * gridSpacing,
      -2 * gridSpacing,
      -24 * gridSpacing,
    ] as const,
  }
}

/** Quadratic cardinal B-splines, with f = x/dx - floor(x/dx - 1/2). */
export const gummyParticleWeights = (f: number) => {
  'use gpu'
  return d.vec3f(
    0.5 * (1.5 - f) * (1.5 - f),
    0.75 - (f - 1) * (f - 1),
    0.5 * (f - 0.5) * (f - 0.5),
  )
}

export const gummyParticleIdentity = () => {
  'use gpu'
  return d.mat3x3f(d.vec3f(1, 0, 0), d.vec3f(0, 1, 0), d.vec3f(0, 0, 1))
}

export const gummyParticleDeterminant = (f: d.m3x3f) => {
  'use gpu'
  return std.dot(f.columns[0], std.cross(f.columns[1], f.columns[2]))
}

/** At zero shear modulus only J remains constitutive state; removing deviatoric memory preserves stress. */
export const gummyParticleVolumeState = (f: d.m3x3f) => {
  'use gpu'
  return std.mul(
    gummyParticleIdentity(),
    std.pow(gummyParticleDeterminant(f), 1 / 3),
  )
}

/** Compressible Neo-Hookean Kirchhoff stress. Damage removes shear memory, never bulk pressure. */
export const gummyParticleStress = (
  f: d.m3x3f,
  mu: number,
  bulk: number,
  damage: number,
) => {
  'use gpu'
  const b = std.mul(f, std.transpose(f))
  const shear = mu * (1 - damage) * (1 - damage)
  const pressure = bulk * std.log(std.max(0.001, gummyParticleDeterminant(f)))
  return std.add(
    std.mul(std.sub(b, gummyParticleIdentity()), shear),
    std.mul(gummyParticleIdentity(), pressure),
  )
}

/**
 * Unilateral warm damage: cracked material resists compression but cannot hold
 * neighbours together through tensile bulk stress after complete softening.
 */
export const gummyParticleWarmStress = (
  f: d.m3x3f,
  mu: number,
  bulk: number,
  damage: number,
) => {
  'use gpu'
  const b = std.mul(f, std.transpose(f))
  const remaining = (1 - damage) * (1 - damage)
  const logJ = std.log(std.max(0.001, gummyParticleDeterminant(f)))
  const pressure = bulk * (std.min(0, logJ) + remaining * std.max(0, logJ))
  return std.add(
    std.mul(std.sub(b, gummyParticleIdentity()), mu * remaining),
    std.mul(gummyParticleIdentity(), pressure),
  )
}

/** CPU readback diagnostic matching the warm pressure potential; never called from a shader. */
export function gummyParticleWarmVolumetricEnergy(
  logJ: number,
  bulk: number,
  damage: number,
) {
  const compression = Math.min(0, logJ)
  const expansion = Math.max(0, logJ)
  const remaining = (1 - damage) * (1 - damage)
  return (
    0.5 * bulk * (compression * compression + remaining * expansion * expansion)
  )
}

/**
 * Fully softened warm material has a tension cutoff at elastic J=1. Returning
 * expansive volume to this zero-pressure state represents opening voids, while
 * keeping every material point and its rest mass. J is now elastic volume,
 * rather than total geometric dilation including those voids.
 */
export const gummyParticleCavitatedVolumeState = (f: d.m3x3f) => {
  'use gpu'
  return std.mul(
    gummyParticleIdentity(),
    std.pow(std.min(1, gummyParticleDeterminant(f)), 1 / 3),
  )
}

const GummyParticleCavitationUpdate = d.struct({
  column0: d.vec3f,
  column1: d.vec3f,
  column2: d.vec3f,
  opening: d.f32,
})

/**
 * Tensile volumetric plastic return. Positive elastic logJ yields at
 * log(1.35)*(1-d), so tensile yield stress decays with the damaged stiffness.
 * Scalar rescaling preserves isochoric shape and rigid-rotation objectivity;
 * compression is unchanged. Removed log-volume is irreversible void opening,
 * not deleted material. The return dissipates elastic energy for J>1.
 */
export const gummyParticleCavitationReturn = (f: d.m3x3f, damage: number) => {
  'use gpu'
  const jacobian = gummyParticleDeterminant(f)
  const limit = std.exp(
    GUMMY_PARTICLE_CAVITATION_LOG_YIELD * (1 - std.clamp(damage, 0, 1)),
  )
  let scale = d.f32(1)
  let opening = d.f32(0)
  if (jacobian > limit) {
    scale = std.pow(limit / jacobian, 1 / 3)
    opening = std.log(jacobian / limit)
  }
  return GummyParticleCavitationUpdate({
    column0: std.mul(f.columns[0], scale),
    column1: std.mul(f.columns[1], scale),
    column2: std.mul(f.columns[2], scale),
    opening,
  })
}

/** Closed-form largest eigenvalue of FᵀF, divided by J^(2/3): invariant to rigid rotations. */
export const gummyParticleStretch = (f: d.m3x3f) => {
  'use gpu'
  const b = std.mul(std.transpose(f), f)
  const q = (b.columns[0].x + b.columns[1].y + b.columns[2].z) / 3
  const a = std.sub(b, std.mul(gummyParticleIdentity(), q))
  const p = std.sqrt(
    (std.dot(a.columns[0], a.columns[0]) +
      std.dot(a.columns[1], a.columns[1]) +
      std.dot(a.columns[2], a.columns[2])) /
      6,
  )
  let largest = d.f32(q)
  if (p > 0.000001) {
    const normalized = std.mul(a, 1 / p)
    const r = std.clamp(gummyParticleDeterminant(normalized) / 2, -1, 1)
    largest = q + 2 * p * std.cos(std.acos(r) / 3)
  }
  return (
    std.sqrt(std.max(0, largest)) /
    std.pow(std.max(0.001, gummyParticleDeterminant(f)), 1 / 3)
  )
}

/** Phenomenological softening, not a fracture-energy or phase-field model. */
export const gummyParticleDamage = (previous: number, peakStretch: number) => {
  'use gpu'
  return std.max(previous, std.smoothstep(1.65, 2.6, peakStretch))
}

/** Viscous stress has its own conservative extrapolation bound; elastic calibration stays unchanged. */
export const gummyParticleViscousSpeedLimit = (
  dt: number,
  dx: number,
  viscosity: number,
  gravity: number,
) => {
  'use gpu'
  // ||dev(sym C)||_F <= ||C||_F, and admitted J <= MAX_J.
  const stress = std.mul(
    std.mul(std.mul(2, viscosity), GUMMY_PARTICLE_MAX_J),
    GUMMY_PARTICLE_MAX_AFFINE,
  )
  const correction = std.div(
    std.mul(std.mul(std.mul(4, dt), stress), std.mul(2.598076211353316, dx)),
    std.mul(dx, dx),
  )
  return std.add(gummyParticleGridSpeedLimit(dt, dx, gravity), correction)
}

/** Newtonian deviatoric stress damps shape flow, without penalizing rigid spin or duplicating bulk pressure. */
export const gummyParticleViscousStress = (
  gradient: d.m3x3f,
  jacobian: number,
  viscosity: number,
) => {
  'use gpu'
  const symmetric = std.mul(std.add(gradient, std.transpose(gradient)), 0.5)
  const dilation =
    (gradient.columns[0].x + gradient.columns[1].y + gradient.columns[2].z) / 3
  return std.mul(
    std.sub(symmetric, std.mul(gummyParticleIdentity(), dilation)),
    2 * viscosity * jacobian,
  )
}

/**
 * Isochoric gradient relaxation of elastic shape. The trace-free left multiplier
 * contracts the largest singular stretches; determinant normalization preserves
 * J exactly. Because B=FF^T is spatial, rigid rotation commutes with this update.
 * This is dissipative viscoplastic creep, not a calibrated fracture-energy law.
 */
const GummyParticleFlowUpdate = d.struct({
  column0: d.vec3f,
  column1: d.vec3f,
  column2: d.vec3f,
  plasticStrain: d.f32,
})

export const gummyParticleFlowStep = (
  f: d.m3x3f,
  dt: number,
  rate: number,
  activation: number,
) => {
  'use gpu'
  const b = std.mul(f, std.transpose(f))
  const trace = b.columns[0].x + b.columns[1].y + b.columns[2].z
  // This bound keeps every multiplier eigenvalue positive even for extreme anisotropy.
  const amount = std.min(
    0.25,
    1 - std.exp(-rate * dt * std.clamp(activation, 0, 1)),
  )
  const multiplier = std.sub(
    std.mul(gummyParticleIdentity(), 1 + amount / 3),
    std.mul(b, amount / std.max(0.000001, trace)),
  )
  const trial = std.mul(multiplier, f)
  const volumeCorrection = std.pow(
    gummyParticleDeterminant(f) / gummyParticleDeterminant(trial),
    1 / 3,
  )
  const relaxed = std.mul(trial, volumeCorrection)
  const increment = std.sub(
    std.mul(multiplier, volumeCorrection),
    gummyParticleIdentity(),
  )
  const squared = std.mul(increment, increment)
  // log(I+A) through cubic order. The bounded multiplier keeps ||A|| small;
  // at the actual CFL microstep the truncation error is below f32 precision.
  const logarithm = std.add(
    std.sub(increment, std.mul(squared, 0.5)),
    std.mul(std.mul(squared, increment), 1 / 3),
  )
  const mean =
    (logarithm.columns[0].x + logarithm.columns[1].y + logarithm.columns[2].z) /
    3
  const deviatoric = std.sub(logarithm, std.mul(gummyParticleIdentity(), mean))
  const equivalent = std.sqrt(
    (2 / 3) *
      (std.dot(deviatoric.columns[0], deviatoric.columns[0]) +
        std.dot(deviatoric.columns[1], deviatoric.columns[1]) +
        std.dot(deviatoric.columns[2], deviatoric.columns[2])),
  )
  return GummyParticleFlowUpdate({
    column0: relaxed.columns[0],
    column1: relaxed.columns[1],
    column2: relaxed.columns[2],
    plasticStrain: equivalent,
  })
}

export const gummyParticleRelaxation = (
  f: d.m3x3f,
  dt: number,
  rate: number,
  activation: number,
) => {
  'use gpu'
  const result = gummyParticleFlowStep(f, dt, rate, activation)
  return d.mat3x3f(result.column0, result.column1, result.column2)
}

/** Continuous, irreversible softening at a time scale independent of solver microsteps. */
export const gummyParticleWarmDamage = (
  previous: number,
  peakStretch: number,
  dt: number,
  rate: number,
  onset: number,
  complete: number,
) => {
  'use gpu'
  const target = std.max(previous, std.smoothstep(onset, complete, peakStretch))
  const updated = previous + (target - previous) * (1 - std.exp(-rate * dt))
  // f32 exponential convergence otherwise stalls below one and retains unbounded shear history.
  // At this threshold the residual shear factor (1-d)^2 is below one part per million.
  if (target >= 1 && updated >= 0.999) return d.f32(1)
  return updated
}

/** A moved pointer must retain its pending drag displacement when a current-space grip is captured. */
export const gummyParticleGripOffset = (
  position: d.v3f,
  center: d.v3f,
  target: d.v3f,
  currentSpace: number,
) => {
  'use gpu'
  return std.sub(position, std.select(target, center, currentSpace > 0))
}

/**
 * Objective damage driver: elastic/plastic stretches compose for coaxial,
 * monotone isochoric uniaxial extension. Equivalent accumulated plastic strain
 * approximates that history for general shear or reversing flow; it is not a
 * stored plastic deformation tensor or a calibrated ductile-fracture law.
 */
export const gummyParticleDamageStretch = (
  peakElastic: number,
  elastic: number,
  plasticStrain: number,
) => {
  'use gpu'
  // The cap only bounds the exponential after full-softening thresholds have already been exceeded.
  return std.max(peakElastic, elastic * std.exp(std.min(2, plasticStrain)))
}
