/** Public particle solver configuration and per-step interactions, without a solver dependency. */
import type { GummyChessMould } from './gummyChessMoulds'
import type { GummyParticleMaterialMode, GummyParticleTuning, prepareGummyParticles, } from './gummyParticleMath'
import type { GummyRookCollider } from './gummyRookCollider'
import type { GummyStep } from './gummySolverContracts'

export type GummyParticleStep = GummyStep & {
  particleMaterial?: GummyParticleMaterialMode
  /** Current selects a spatial patch of deformed material; rest preserves scripted baseline grips. */
  gripSpace?: 'rest' | 'current'
  fragility?: number
  tuning?: Partial<GummyParticleTuning>
  /** Prescribed rigid rook; the victim is the only deformable body in this solver. */
  collider?: GummyRookCollider
  /** Moving grip attachment, optionally restricted to the original base material. */
  gripMotion?: {
    velocity: readonly [number, number, number]
    baseHeight?: number
  }
}

export type GummyParticleOptions = Parameters<
  typeof prepareGummyParticles
>[0] & {
  /** Simulation-space placement; the public rest dye coordinates remain mould-local. */
  initialOffset?: readonly [number, number, number]
  initialRotationY?: number
  colliderMould?: GummyChessMould
  colliderRotationY?: number
  gridOrigin?: readonly [number, number, number]
  gridSize?: number
  /** Enable independent-grid geometric contact gathers for the pair owner. */
  pairContact?: boolean
}
