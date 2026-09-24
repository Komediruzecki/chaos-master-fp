/**
 * Reads back which symmetry a flame's generated `_sym__` transforms make, so
 * the Symmetry card can show the type and fold count and rebuild the set when
 * one of them changes.
 *
 * The mirror is how a dihedral set is told from a rotational one. It is kept
 * separate from `symmetry.ts`, which writes the transforms, so both can be
 * tested against each other.
 */
import type { TransformFunction } from '@/flame/schema/flameSchema'

export type SymmetryType = 'rotational' | 'dihedral'

type AffineLike = Readonly<Record<string, number | undefined>>

/**
 * True when a preAffine is the mirror of a dihedral symmetry set, x -> -x.
 * Only the linear part is compared; the translation is not.
 */
export function isSymmetryMirror(affine: AffineLike | undefined): boolean {
  if (!affine) return false
  return affine.a === -1 && affine.d === 0 && affine.b === 0 && affine.e === 1
}

type SymTransform = Pick<TransformFunction, 'preAffine'> | undefined

/** Dihedral when any of the generated transforms is the mirror. */
export function detectSymmetryType(
  symTransforms: readonly SymTransform[],
): SymmetryType {
  return symTransforms.some((t) => isSymmetryMirror(t?.preAffine))
    ? 'dihedral'
    : 'rotational'
}

/**
 * The fold count n the generated transforms stand for: n - 1 rotations, plus
 * the mirror for a dihedral set. With no transforms it is 1.
 */
export function detectSymmetryFolds(
  symTransforms: readonly SymTransform[],
): number {
  return detectSymmetryType(symTransforms) === 'dihedral'
    ? symTransforms.length
    : symTransforms.length + 1
}
