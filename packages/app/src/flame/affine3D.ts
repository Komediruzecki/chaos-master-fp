/** Pure affine layout conversion shared by GPU kernels and CPU workers. */
import type { AffineParams3D } from '@chaos-master/core'
import type { AffineLayout } from '@/arcade/affineTerms'

export function isAffine3D(
  affine: Record<string, number | undefined> | undefined,
): boolean {
  if (!affine) return false
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
 * Any affine as the 3D kernel's twelve numbers, read in `layout`: in the 3D
 * layout with its missing fields at the identity's, in the 2D one lifted (its
 * translation `c`, `f` into `d`, `h`, and z passed through unchanged), and
 * none at all as the identity. `layout` defaults to the one the 3D renderer
 * reads the affine in; a 2D flame's renderer reads every affine in the 2D one
 * (affineLayoutOf in arcade/affineTerms.ts). The 3D pipeline writes a flame's
 * final transform through this, and the Flame Clash lifts each fighter's
 * affines with it.
 */
export function toAffine3D(
  affine: Record<string, number | undefined> | undefined,
  layout: AffineLayout = isAffine3D(affine) ? '3D' : '2D',
): AffineParams3D {
  const ft = affine ?? {}
  const at = (key: string, missing: number) => ft[key] ?? missing
  if (layout === '3D') {
    return {
      a: at('a', 1),
      b: at('b', 0),
      c: at('c', 0),
      d: at('d', 0),
      e: at('e', 0),
      f: at('f', 1),
      g: at('g', 0),
      h: at('h', 0),
      i: at('i', 0),
      j: at('j', 0),
      k: at('k', 1),
      l: at('l', 0),
    }
  }
  return {
    a: at('a', 1),
    b: at('b', 0),
    c: 0,
    d: at('c', 0), // Translation X
    e: at('d', 0),
    f: at('e', 1),
    g: 0,
    h: at('f', 0), // Translation Y
    i: 0,
    j: 0,
    k: 1,
    l: 0,
  }
}
