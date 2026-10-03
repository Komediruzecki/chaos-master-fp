/** Objective continuum stress and quadratic MLS transfers for the separate particle jelly study. */
import { d, std } from 'typegpu'
import { gummyBearField } from './gummyMesh'

export const GUMMY_PARTICLE_OUTER_DT = 1 / 120
export const GUMMY_PARTICLE_GRID_SIZE = 48
export const GUMMY_PARTICLE_MAX_SPEED = 32
export const GUMMY_PARTICLE_MAX_AFFINE = 60
export const GUMMY_PARTICLE_MAX_F_NORM = 6
export const GUMMY_PARTICLE_MIN_J = 0.2
export const GUMMY_PARTICLE_MAX_J = 5
export const GUMMY_PARTICLE_MAX_SHEAR = 350
export const GUMMY_PARTICLE_BULK = 800

export function gummyParticleMaterial(softness: number) {
  const s = Number.isFinite(softness) ? Math.max(0, Math.min(1, softness)) : 0.5
  return {
    shearModulus: GUMMY_PARTICLE_MAX_SHEAR * 0.35 ** s,
    bulkModulus: GUMMY_PARTICLE_BULK,
    density: 1,
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
export const gummyParticleGridSpeedLimit = (dt: number, dx: number) => {
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
  // Gravity adds 9.81dt; a prescribed platen can impose at most 2 units/s.
  return std.add(std.add(transferSpeed, std.mul(9.81, dt)), 2)
}

/** Equal-volume samples of the actual mould; no pre-cut regions or fragment labels. */
export function prepareGummyParticles(
  options: {
    spacing?: number
    pinnedFeet?: boolean
    pinHeight?: number
  } = {},
) {
  const spacing = options.spacing ?? 0.08
  if (!Number.isFinite(spacing) || spacing < 0.06 || spacing > 0.12)
    throw new Error('Particle spacing must be between 0.06 and 0.12')
  const pinHeight = options.pinHeight ?? 0.48
  if (!Number.isFinite(pinHeight) || pinHeight < 0 || pinHeight > 0.6)
    throw new Error('Particle pin height must be between zero and 0.6')
  const points: number[] = []
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let iy = 0; iy * spacing < 2.6; iy++)
    for (let iz = Math.floor(-0.55 / spacing); iz * spacing < 0.6; iz++)
      for (let ix = Math.floor(-0.8 / spacing); ix * spacing < 0.8; ix++) {
        const x = (ix + 0.5) * spacing
        const y = (iy + 0.5) * spacing
        const z = (iz + 0.5) * spacing
        if (gummyBearField([x, y, z]) > 0) continue
        points.push(
          x,
          y,
          z,
          options.pinnedFeet !== false && y < pinHeight ? 0 : 1,
        )
        for (const [axis, value] of [x, y, z].entries()) {
          min[axis] = Math.min(min[axis]!, value)
          max[axis] = Math.max(max[axis]!, value)
        }
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
    nodalSpeedBound: gummyParticleGridSpeedLimit(fixedDt, gridSpacing),
    particleVolume: spacing ** 3,
    restVolume,
    pinHeight: options.pinnedFeet !== false ? pinHeight : 0,
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
