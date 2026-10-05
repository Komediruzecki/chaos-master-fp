/** Root-owned unbound shader cores survive solver replacement without retaining old buffers. */
import type { TgpuComputePipeline, TgpuRoot } from 'typegpu'
import type { gummyPredict } from './gummySolverShaders'

type Compute = typeof gummyPredict
const roots = new WeakMap<TgpuRoot, Map<Compute, TgpuComputePipeline>>()

export function gummySolverPipeline(root: TgpuRoot, compute: Compute) {
  let cache = roots.get(root)
  if (!cache) {
    cache = new Map()
    roots.set(root, cache)
  }
  let pipeline = cache.get(compute)
  if (!pipeline) {
    pipeline = root.createComputePipeline({ compute })
    cache.set(compute, pipeline)
  }
  return pipeline
}
