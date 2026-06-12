/**
 * Flame randomization utilities.
 *
 * Re-exports everything from renderer-core.
 */

export {
  random01,
  randomRange,
  randomPerturbation,
  randomizeVariationParams,
  randomizeVariationType,
  pickRandomVariationType,
  randomizeAllColors,
  randomizeAffineCoef,
  generateRandomFlame,
} from 'renderer-core/flame/randomize'

export type { GenerateRandomFlameConfig } from 'renderer-core/flame/randomize'
