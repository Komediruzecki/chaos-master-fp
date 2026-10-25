/** MLS-MPM particle/grid state schemas and shared solver bindings. */
import { d, tgpu } from 'typegpu'

export const GummyParticleParameters = d.struct({
  geometry: d.vec4f,
  material: d.vec4f,
  origin: d.vec4f,
  counts: d.vec4u,
  gripCenter: d.vec4f,
  gripTarget: d.vec4f,
  press: d.vec4f,
  limits: d.vec4f,
  /** Warm mode, shape relaxation rate, damage rate, maximum viscosity. */
  rheology: d.vec4f,
  /** Current-space selection, grip spring, grip damping, floor drag per second. */
  interaction: d.vec4f,
  /** Yield stretch, damage onset, full-softening stretch, reserved. */
  fracture: d.vec4f,
  /** Prescribed rook translation and enabled flag. */
  colliderPosition: d.vec4f,
  /** Linear velocity and Coulomb friction coefficient. */
  colliderVelocity: d.vec4f,
  /** Moving grip target velocity and optional base-only capture height. */
  gripMotion: d.vec4f,
  /** Initial delta yaw, angular velocity about Y, reserved. Appended to preserve existing offsets. */
  colliderRotation: d.vec4f,
})
export const GummyParticleState = d.struct({
  deformation: d.mat3x3f,
  affine: d.mat3x3f,
  /** Damage, historical peak isochoric stretch, speed caps, affine-gradient caps. */
  history: d.vec4f,
  /** Rejected deformation-gradient updates, domain contacts, zero-shear state reductions, creep updates. */
  diagnostics: d.vec4f,
  /** Peak raw grid speed, transferred clipping impulse, direct particle caps, grid cap touches. */
  transfer: d.vec4f,
  /** Next particle in the support-base bucket; zero terminates an index-plus-one list. */
  links: d.vec4u,
  /** Equivalent plastic strain, volumetric void opening, cavitation returns, reserved. */
  flow: d.vec4f,
  /** Current rook surface normal and signed particle gap, cached once per microstep. */
  contact: d.vec4f,
})
export const GummyParticleGrid = d.struct({
  head: d.atomic(d.u32),
  occupied: d.atomic(d.u32),
  mass: d.f32,
  pinned: d.u32,
  /** Weighted geometric contact normal and contact mass; used by separate-body coupling. */
  contact: d.vec4f,
})
export const gummyParticleLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParticleParameters },
  positions: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  velocities: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  states: { storage: d.arrayOf(GummyParticleState), access: 'mutable' },
  rest: { storage: d.arrayOf(d.vec4f) },
  grip: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  grid: { storage: d.arrayOf(GummyParticleGrid), access: 'mutable' },
  gridVelocities: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  clock: { storage: d.arrayOf(d.f32), access: 'mutable' },
})
