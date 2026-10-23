/** Validated interaction packing for the fixed MLS-MPM uniform layout. */
import { GUMMY_PARTICLE_MAX_AFFINE, GUMMY_PARTICLE_MAX_F_NORM, GUMMY_PARTICLE_MAX_SPEED, GUMMY_PARTICLE_OUTER_DT, } from './gummyParticleMath'
import { normalizeGummyPress } from './gummySolverMaterial'
import type { GummyParticleStep } from './gummyParticleContracts'
import type { gummyParticleMaterial } from './gummyParticleMath'
import type { prepareGummyParticleSolver } from './gummyParticlePreparation'
import type { normalizeGummyRookCollider } from './gummyRookCollider'

export function validateGummyParticleGripMotion(
  motion: GummyParticleStep['gripMotion'],
) {
  if (
    motion &&
    (!motion.velocity.every(Number.isFinite) ||
      Math.hypot(...motion.velocity) > 32 ||
      !Number.isFinite(motion.baseHeight ?? 0) ||
      (motion.baseHeight ?? 0) < 0 ||
      (motion.baseHeight ?? 0) > 0.6)
  )
    throw new RangeError('Grip motion must be finite and bounded')
}

function writeGrip(f32: Float32Array, input: GummyParticleStep) {
  if (input.grip) {
    if (
      ![...input.grip.center, ...input.grip.target, input.grip.radius].every(
        Number.isFinite,
      ) ||
      input.grip.radius <= 0
    )
      throw new Error(
        'Particle grip must have finite coordinates and a positive radius',
      )
    f32.set([...input.grip.center, input.grip.radius], 16)
    f32.set([...input.grip.target, 1], 20)
  }
}

function writePress(
  f32: Float32Array,
  input: GummyParticleStep,
  spacing: number,
  previousPressHeight: number | undefined,
  count: number,
) {
  const press = normalizeGummyPress(input.press)
  if (press) {
    const velocity =
      previousPressHeight === undefined
        ? 0
        : Math.max(
            -2,
            Math.min(
              2,
              (press.height - previousPressHeight) /
                (count * GUMMY_PARTICLE_OUTER_DT),
            ),
          )
    f32.set(
      [Math.max(spacing, press.height), press.halfExtent, 1, velocity],
      24,
    )
  }
  return press?.height
}

export function writeGummyParticleUniforms(
  f32: Float32Array,
  u32: Uint32Array,
  input: GummyParticleStep,
  prepared: ReturnType<typeof prepareGummyParticleSolver>,
  pairContact: boolean | undefined,
  previousPressHeight: number | undefined,
  count: number,
  collider: ReturnType<typeof normalizeGummyRookCollider>,
  lastMaterial: ReturnType<typeof gummyParticleMaterial>,
) {
  const {
    fixedDt,
    gridSpacing,
    geometry,
    spacing,
    gridOrigin,
    particleCount,
    gridSize,
    gridCount,
  } = prepared
  f32.fill(0)
  f32.set([fixedDt, gridSpacing, geometry.particleVolume, spacing * 0.5], 0)
  f32.set(
    [
      lastMaterial.shearModulus,
      lastMaterial.bulkModulus,
      0.35,
      input.tearing ? 1 : 0,
    ],
    4,
  )
  f32.set([...gridOrigin, geometry.pinHeight], 8)
  u32.set([particleCount, gridSize, gridCount, pairContact ? 1 : 0], 12)
  writeGrip(f32, input)
  const pressHeight = writePress(
    f32,
    input,
    spacing,
    previousPressHeight,
    count,
  )
  f32.set(
    [
      GUMMY_PARTICLE_MAX_SPEED,
      GUMMY_PARTICLE_MAX_AFFINE,
      GUMMY_PARTICLE_MAX_F_NORM,
      lastMaterial.gravity,
    ],
    28,
  )
  f32.set(
    [
      lastMaterial.mode === 'warm' ? 1 : 0,
      lastMaterial.relaxationRate,
      lastMaterial.damageRate,
      lastMaterial.viscosity,
    ],
    32,
  )
  f32.set(
    [
      input.gripSpace === 'current' ? 1 : 0,
      lastMaterial.gripStiffness,
      lastMaterial.gripDamping,
      lastMaterial.floorDrag,
    ],
    36,
  )
  f32.set(
    [
      lastMaterial.yieldStretch,
      lastMaterial.damageOnset,
      lastMaterial.damageComplete,
      0,
    ],
    40,
  )
  if (collider) {
    f32.set([...collider.position, 1], 44)
    f32.set([...collider.velocity, collider.friction], 48)
    f32.set([collider.rotationY, collider.angularVelocityY, 0, 0], 56)
  }
  if (input.gripMotion)
    f32.set(
      [...input.gripMotion.velocity, input.gripMotion.baseHeight ?? 0],
      52,
    )
  const key = input.grip
    ? `${input.gripSpace ?? 'rest'}:${input.grip.center.join(':')}:${input.grip.radius}:${input.gripMotion?.baseHeight ?? 0}`
    : ''
  return { pressHeight, key }
}
