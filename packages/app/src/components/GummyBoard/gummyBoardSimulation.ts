/** Select the preserved driven-rook study or two deforming bodies with a shared board API. */
import { createGummyParticlePairSolver } from '@/simulation/gummy/gummyParticlePairSolver'
import { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'
import type { TgpuRoot } from 'typegpu'
import type { GummyParticleStep } from '@/simulation/gummy/gummyParticleSolver'

export type GummyBoardCollisionMode = 'soft' | 'driven'

export function createGummyBoardSimulation(
  root: TgpuRoot,
  device: GPUDevice,
  options: { collisionMode: GummyBoardCollisionMode; pinnedFeet: boolean },
) {
  const pair =
    options.collisionMode === 'soft'
      ? createGummyParticlePairSolver(root, device, {
          pinnedFeet: options.pinnedFeet,
        })
      : undefined
  const pawn =
    pair?.pawn ??
    createGummyParticleSolver(root, device, {
      fixture: 'pawn',
      pinnedFeet: options.pinnedFeet,
    })
  return {
    pawn,
    rook: pair?.rook,
    step(dt: number, input: GummyParticleStep) {
      if (pair) {
        const { collider, ...material } = input
        return pair.step(dt, { ...material, rookGuide: collider })
      }
      return pawn.step(dt, input)
    },
    reset() {
      if (pair) pair.reset()
      else pawn.reset()
    },
    destroy() {
      if (pair) pair.destroy()
      else pawn.destroy()
    },
  }
}
