// The transform targets the wiring editor's Randomize may draw for one
// transform: the scale pair, its probability and one of its variation weights.
import type { FlameTarget, TransformInfo } from '@/utils/audioAnalysis'

/**
 * `pick(count)` is the caller's random source: an index below `count`.
 *
 * `a` and `e` are the diagonal of x' = a x + b y + c, y' = d x + e y + f, so
 * together they scale the branch; `d` would shear it.
 */
export function transformTargetPool(
  transform: TransformInfo,
  pick: (count: number) => number,
): FlameTarget[] {
  const transformIdx = transform.index
  const pool: FlameTarget[] = [
    { kind: 'transformAffine', transformIdx, matrix: 'preAffine', param: 'a' },
    { kind: 'transformAffine', transformIdx, matrix: 'preAffine', param: 'e' },
    { kind: 'transformProperty', transformIdx, property: 'probability' },
  ]
  const variation = transform.variations[pick(transform.variations.length)]
  if (variation) {
    pool.push({
      kind: 'variationWeight',
      transformIdx,
      variationType: variation.type,
    })
  }
  return pool
}
