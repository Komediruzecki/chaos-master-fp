/** Playable lattice source opens native tetrahedral facets and widens branches before thickening. */
import { buildStructuralPawnFlame } from '@/flame/chess/structuralPawnFlame'
import type { PawnRecipe } from '@/flame/chess/pawnFlame'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/** Affine frame conjugation preserves each component's original recursive maps. */
export function buildAuthoredPawnFlame(
  recipe: PawnRecipe,
  radius: number,
): FlameDescriptor {
  const flame = buildStructuralPawnFlame(recipe)
  const selectedHeads = new Set(
    Array.from(
      { length: recipe.branchCount },
      (_, index) =>
        `head_${String(Math.floor((index * 20) / recipe.branchCount)).padStart(2, '0')}`,
    ),
  )
  const transforms = Object.fromEntries(
    Object.entries(flame.transforms)
      .filter(
        ([, transform]) =>
          !transform.walkGroup?.startsWith('head_') ||
          selectedHeads.has(transform.walkGroup),
      )
      .map(([id, transform]) => {
        const affine = transform.postAffine
        if (
          !affine ||
          !('g' in affine) ||
          typeof affine.g !== 'number' ||
          typeof affine.j !== 'number' ||
          typeof affine.l !== 'number'
        )
          throw new Error('Authored pawn requires native 3D affine maps')
        const scale =
          transform.walkGroup === 'shaft'
            ? 2
            : transform.walkGroup === 'collar'
              ? 1.5
              : transform.walkGroup === 'foot'
                ? 0.92
                : 1.65
        return [
          id,
          {
            ...transform,
            postAffine: {
              ...affine,
              b: affine.b * scale,
              d: affine.d * scale,
              e: affine.e / scale,
              g: affine.g / scale,
              j: affine.j * scale,
              l: affine.l * scale,
            },
          },
        ]
      }),
  )
  return {
    ...flame,
    metadata: {
      ...flame.metadata,
      name: 'Playable lattice pawn',
      description:
        'Selected native Sierpinski facets, widened recursive branches and a Menger foot. The playable solid thickens this source at a fixed material radius.',
    },
    transforms,
    finalTransform: {
      a: 1,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 1.26,
      g: 0,
      h: radius,
      i: 0,
      j: 0,
      k: 1,
      l: 0,
    },
    renderSettings: {
      ...flame.renderSettings,
      camera3D: {
        theta: 0.45,
        phi: 1.25,
        radius: 4.6,
        target: [0, 1.25, 0],
        fov: 45,
        roll: 0,
      },
    },
  }
}
