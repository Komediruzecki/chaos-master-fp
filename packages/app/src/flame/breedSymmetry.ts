// The symmetry set a bred child inherits: the one of the parent it takes the most user transforms from, written fresh by the symmetry writer.
import { isSymmetryCopyId } from './mutationOperators'
import { applySymmetryToFlame } from './symmetry'
import { detectSymmetryFolds, detectSymmetryType } from './symmetryDetection'
import type { FlameDescriptor } from './schema/flameSchema'
import type { SymmetryType } from './symmetryDetection'

/** Which parent a gene came from. A cross-bred pair of both has none. */
export type BreedParent = 'a' | 'b'

/** A flame's transforms without its `_sym__` copies: what Breed breeds from. */
export function breedableEntries<T>(
  transforms: Record<string, T>,
): [string, T][] {
  return Object.entries(transforms).filter(([tid]) => !isSymmetryCopyId(tid))
}

/** The set a flame's copies make, as the Symmetry card reads it, or
 *  undefined when it has none. */
export function symmetrySetOf(
  flame: FlameDescriptor,
): { folds: number; type: SymmetryType } | undefined {
  const values = Object.entries(flame.transforms)
    .filter(([tid]) => isSymmetryCopyId(tid))
    .map(([, t]) => t)
  if (values.length === 0) return undefined
  return {
    folds: detectSymmetryFolds(values),
    type: detectSymmetryType(values),
  }
}

/**
 * Gives a child the symmetry set of the parent it takes the most user
 * transforms from (the first parent on a tie), or none when that parent has
 * none. The set is read back from the parent's copies and written anew, so
 * the copies come out in the child's layout at `symmetryWeight`, and a set
 * whose rotations were edited with the angle editor comes out as a clean
 * n-fold set.
 */
export function inheritSymmetry(
  child: FlameDescriptor,
  parentA: FlameDescriptor,
  parentB: FlameDescriptor,
  fromA: number,
  fromB: number,
): FlameDescriptor {
  const set = symmetrySetOf(fromA >= fromB ? parentA : parentB)
  return set ? applySymmetryToFlame(child, set.folds, set.type) : child
}
