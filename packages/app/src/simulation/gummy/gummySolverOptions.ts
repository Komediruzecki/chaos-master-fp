/** XPBD construction options and bounded Neo-Hookean convergence settings. */
import { GUMMY_JELLY_SOLVER_ITERATIONS } from './gummyJelly'
import type { GummySolverPreparationCache } from './gummySolverPreparation'

export type GummySolverOptions = {
  /** Static opt-in keeps the original spring and cohesive experiments unchanged. */
  materialModel?: 'edge-volume' | 'neo-hookean'
  /** Construction-time convergence budget for Neo-Hookean material only. */
  jellyIterations?: number
  /** Internal integration steps per logical 1/120-second tick; ignored by legacy materials. */
  jellySubsteps?: number
  /** Scene-owned, validated rest-data reuse across topology-only splits. */
  preparationCache?: GummySolverPreparationCache
  /** Maps each new node to the previous mesh node after splitting. */
  sourceNodes?: Uint32Array
}
export function gummySolverConvergence(options: GummySolverOptions) {
  const jellyIterations =
    options.jellyIterations ?? GUMMY_JELLY_SOLVER_ITERATIONS
  if (
    !Number.isInteger(jellyIterations) ||
    jellyIterations < 1 ||
    jellyIterations > 96
  )
    throw new RangeError(
      'Jelly solver iterations must be an integer between 1 and 96',
    )
  const jellySubsteps = options.jellySubsteps ?? 1
  if (
    !Number.isInteger(jellySubsteps) ||
    jellySubsteps < 1 ||
    jellySubsteps > 8
  )
    throw new RangeError('Jelly substeps must be an integer between 1 and 8')
  return { jellyIterations, jellySubsteps }
}
