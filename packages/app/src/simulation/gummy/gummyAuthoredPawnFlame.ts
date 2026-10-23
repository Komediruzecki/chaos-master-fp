/** Versioned playable sources preserve the original facets and add a balanced open crown. */
import { buildStructuralPawnFlame } from '@/flame/chess/structuralPawnFlame'
import type { PawnRecipe } from '@/flame/chess/pawnFlame'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/** Affine frame conjugation preserves each component's original recursive maps. */
export function buildAuthoredPawnFlame(
  recipe: PawnRecipe,
  radius: number,
  version: 1 | 2 = 1,
): FlameDescriptor {
  if (version === 2) return buildOpenCrownPawnFlame(recipe, radius)
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

/** Four similarity maps for a connected Koch arc between two world-space endpoints. */
function kochArc(
  from: readonly number[],
  to: readonly number[],
  angle: number,
) {
  const delta = to.map((value, axis) => value - from[axis]!)
  const length = Math.hypot(...delta)
  const u = delta.map((value) => value / length)
  const radialDelta = delta[0]! * Math.cos(angle) + delta[2]! * Math.sin(angle)
  const v = [
    (-delta[1]! * Math.cos(angle)) / length,
    radialDelta / length,
    (-delta[1]! * Math.sin(angle)) / length,
  ]
  const n = [-Math.sin(angle), 0, Math.cos(angle)]
  return [
    [0, 0, 0],
    [-Math.PI / 3, 1 / 3, 0],
    [Math.PI / 3, 0.5, -Math.sqrt(3) / 6],
    [0, 2 / 3, 0],
  ].map(([turn, x, y]) => {
    const c = Math.cos(turn!),
      sine = Math.sin(turn!)
    const rows = Array.from({ length: 3 }, (_, row) =>
      Array.from(
        { length: 3 },
        (_, column) =>
          (c * (row === column ? 1 : 0) +
            (1 - c) * n[row]! * n[column]! +
            sine * (v[row]! * u[column]! - u[row]! * v[column]!)) /
          3,
      ),
    )
    const offset = from.map(
      (value, row) =>
        value +
        length * (u[row]! * x! + v[row]! * y!) -
        rows[row]!.reduce(
          (sum, coefficient, column) => sum + coefficient * from[column]!,
          0,
        ),
    )
    return {
      a: rows[0]![0]!,
      b: rows[0]![1]!,
      c: rows[0]![2]!,
      d: offset[0]!,
      e: rows[1]![0]!,
      f: rows[1]![1]!,
      g: rows[1]![2]!,
      h: offset[1]!,
      i: rows[2]![0]!,
      j: rows[2]![1]!,
      k: rows[2]![2]!,
      l: offset[2]!,
    }
  })
}

/**
 * Rotational Koch bows meet only at the top and bottom poles. Unlike filled
 * meridian sheets, this leaves a large central cavity after particle surface
 * reconstruction. Recursion belongs to each curve, never to whole pawn copies.
 */
function buildOpenCrownPawnFlame(
  recipe: PawnRecipe,
  radius: number,
): FlameDescriptor {
  const legacy = buildAuthoredPawnFlame(recipe, radius, 1)
  const transforms = Object.fromEntries(
    Object.entries(legacy.transforms).filter(
      ([, transform]) => !transform.walkGroup?.startsWith('head_'),
    ),
  )
  const template = Object.values(legacy.transforms)[0]!
  const crownRadius = 0.45 + 0.09 * recipe.openness
  for (let branch = 0; branch < recipe.branchCount; branch++) {
    const angle = recipe.twist + (branch * 2 * Math.PI) / recipe.branchCount
    const vertices = [
      [0, 1.12, 0],
      [crownRadius * Math.cos(angle), 1.48, crownRadius * Math.sin(angle)],
      [0, 1.84, 0],
    ] as const
    for (let edge = 0; edge < 2; edge++) {
      const maps = kochArc(vertices[edge]!, vertices[edge + 1]!, angle)
      for (const [map, affine] of maps.entries())
        transforms[`crown_${branch}_${edge}_${map}`] = {
          ...template,
          walkGroup: `head_${String(branch).padStart(2, '0')}_${edge}`,
          probability: 0.4 / (8 * recipe.branchCount),
          postAffine: affine,
        }
    }
  }
  return {
    ...legacy,
    metadata: {
      ...legacy.metadata,
      name: 'Open crown lattice pawn',
      description:
        'Rotational Koch bows form a hollow crown above a recursive stem and Menger foot. The solid uses a thinner crown and a stronger stem and base.',
    },
    transforms,
  }
}
