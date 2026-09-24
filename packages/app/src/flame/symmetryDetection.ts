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
 * True when a preAffine uses the 3D key layout. The same test the 3D renderer
 * makes (`isAffine3D` in transformFunction3D.ts): any of `g`-`l` present.
 */
function has3DLayout(affine: AffineLike): boolean {
  return (
    affine.g !== undefined ||
    affine.h !== undefined ||
    affine.i !== undefined ||
    affine.j !== undefined ||
    affine.k !== undefined ||
    affine.l !== undefined
  )
}

/**
 * True when a preAffine is the mirror of a dihedral symmetry set, x -> -x, in
 * either key layout. Only the linear part is compared; the translation is not,
 * as before.
 *
 * - 2D layout `{ a b c / d e f }`, c and f the translation: `a -1, b 0, d 0,
 *   e 1`. This is what `symmetry.ts` writes for a 2D flame, and what the
 *   `flame.applySymmetry` command writes for a 2D and a 3D flame alike.
 * - 3D layout `{ a b c d / e f g h / i j k l }`, d, h and l the translation:
 *   `a -1, b 0, c 0, e 0, f 1, g 0, i 0, j 0, k 1`. This is what `symmetry.ts`
 *   writes for a 3D flame, and what loading a 3D flame turns the 2D-layout
 *   mirror into (`migrateAffine2Dto3D` in core), so a flame saved as dihedral
 *   reads back as dihedral.
 */
export function isSymmetryMirror(affine: AffineLike | undefined): boolean {
  if (!affine) return false
  if (has3DLayout(affine)) {
    return (
      affine.a === -1 &&
      affine.b === 0 &&
      affine.c === 0 &&
      affine.e === 0 &&
      affine.f === 1 &&
      affine.g === 0 &&
      affine.i === 0 &&
      affine.j === 0 &&
      affine.k === 1
    )
  }
  return affine.a === -1 && affine.b === 0 && affine.d === 0 && affine.e === 1
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
