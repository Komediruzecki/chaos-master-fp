// Repeatable orbit paths shared by CPU caching and GPU cloud construction.
import { d, tgpu } from 'typegpu'
import { advancePoint, advanceSeed } from './flameMath'

export const CHAIN_COUNT = 1024
export const SAMPLES_PER_CHAIN = 32
export const BURN_IN = 64
export const FLAME_SEED = 73129
export const POINT_COUNT = CHAIN_COUNT * SAMPLES_PER_CHAIN
export const initialPoint = tgpu.const(d.vec4f, d.vec4f(0.17, -0.23, 0.31, 0))

/** The reference follows the same bounded paths as the GPU, once at startup. */
export function sampleCachedPoints() {
  const output = new Float32Array(POINT_COUNT * 4)
  for (let chain = 0; chain < CHAIN_COUNT; chain++) {
    let point = d.vec4f(initialPoint.$)
    let seed = FLAME_SEED + chain
    for (let step = -BURN_IN; step < SAMPLES_PER_CHAIN; step++) {
      seed = advanceSeed(seed)
      point = advancePoint(point, seed)
      if (step >= 0)
        output.set(
          [point.x, point.y, point.z, point.w],
          (chain * SAMPLES_PER_CHAIN + step) * 4,
        )
    }
  }
  if (!output.every(Number.isFinite)) throw new Error('Non-finite cached flame')
  return output
}
