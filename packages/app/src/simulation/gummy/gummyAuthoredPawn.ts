/** Versioned editable lattice-pawn snapshots and shared finite-thickness material sampling. */
import { normalizePawnRecipe, PAWN_RECIPE_LIMITS, } from '@/flame/chess/pawnFlame'
import { DEFAULT_STRUCTURAL_PAWN_RECIPE } from '@/flame/chess/structuralPawnFlame'
import { buildAuthoredPawnFlame } from './gummyAuthoredPawnFlame'
import { bakeAuthoredPawnVolume } from './gummyAuthoredPawnVolume'
import type { PawnRecipe } from '@/flame/chess/pawnFlame'

export type GummyAuthoredPawn = {
  format: 'gummy-authored-pawn'
  version: 1 | 2
  name: string
  recipe: PawnRecipe
  seed: number
  /** Structural dilation radius in pawn-local units; v2 uses a thinner crown. */
  thickness: number
}

export const GUMMY_AUTHORED_PAWN_THICKNESS = Object.freeze({
  min: 0.12,
  max: 0.18,
  default: 0.14,
})
const BOUNDS = { min: [-0.82, 0, -0.82], max: [0.82, 2.65, 0.82] } as const
type Point = readonly [number, number, number]
const volumes = new Map<string, ReturnType<typeof bakeAuthoredPawnVolume>>()

export function createGummyAuthoredPawn(
  recipe: Partial<PawnRecipe> = {},
  name = 'Lattice pawn',
  version: GummyAuthoredPawn['version'] = 2,
): GummyAuthoredPawn {
  return {
    format: 'gummy-authored-pawn',
    version,
    name: validName(name.trim().slice(0, 64))
      ? name.trim().slice(0, 64)
      : 'Lattice pawn',
    recipe: normalizePawnRecipe({
      ...DEFAULT_STRUCTURAL_PAWN_RECIPE,
      ...(version === 2 ? { branchCount: 4, openness: 0.65 } : {}),
      ...recipe,
    }),
    seed: 0x7061776e,
    thickness: GUMMY_AUTHORED_PAWN_THICKNESS.default,
  }
}

/** Editable native IFS source shares its versioned geometry and frame with the material bake. */
export function buildGummyAuthoredPawnFlame(snapshot: GummyAuthoredPawn) {
  return buildAuthoredPawnFlame(
    snapshot.recipe,
    snapshot.thickness,
    snapshot.version,
  )
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function range(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  )
}

function validName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    value === value.trim() &&
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
  )
}

/** Imports reject unsupported or out-of-range controls instead of silently changing artwork. */
export function validateGummyAuthoredPawn(
  value: unknown,
): GummyAuthoredPawn | undefined {
  const raw = record(value)
  const recipe = record(raw?.recipe)
  if (
    !raw ||
    !recipe ||
    Object.keys(raw).some(
      (key) =>
        !['format', 'version', 'name', 'recipe', 'seed', 'thickness'].includes(
          key,
        ),
    ) ||
    Object.keys(recipe).some(
      (key) => !['branchCount', 'openness', 'twist', 'side'].includes(key),
    ) ||
    raw.format !== 'gummy-authored-pawn' ||
    (raw.version !== 1 && raw.version !== 2) ||
    !validName(raw.name) ||
    !range(raw.seed, 0, 0xffffffff) ||
    !Number.isInteger(raw.seed) ||
    !range(
      raw.thickness,
      GUMMY_AUTHORED_PAWN_THICKNESS.min,
      GUMMY_AUTHORED_PAWN_THICKNESS.max,
    ) ||
    !range(
      recipe.branchCount,
      PAWN_RECIPE_LIMITS.branchCount.min,
      PAWN_RECIPE_LIMITS.branchCount.max,
    ) ||
    !Number.isInteger(recipe.branchCount) ||
    !range(recipe.openness, 0, 1) ||
    !range(
      recipe.twist,
      PAWN_RECIPE_LIMITS.twist.min,
      PAWN_RECIPE_LIMITS.twist.max,
    ) ||
    (recipe.side !== 'light' && recipe.side !== 'dark')
  )
    return undefined
  return {
    format: 'gummy-authored-pawn',
    version: raw.version,
    name: raw.name,
    seed: raw.seed,
    thickness: raw.thickness,
    recipe: {
      branchCount: recipe.branchCount,
      openness: recipe.openness,
      twist: recipe.twist,
      side: recipe.side,
    },
  }
}

/** Names and palette-side metadata do not duplicate identical geometry in the cache. */
export function gummyAuthoredPawnKey(snapshot?: GummyAuthoredPawn): string {
  if (!snapshot) return ''
  return JSON.stringify([
    'gummy-authored-pawn',
    snapshot.version,
    snapshot.recipe.branchCount,
    snapshot.recipe.openness,
    snapshot.recipe.twist,
    snapshot.seed,
    snapshot.thickness,
  ])
}

export function createAuthoredPawnField(snapshot: GummyAuthoredPawn) {
  const key = gummyAuthoredPawnKey(snapshot)
  let field = volumes.get(key)
  if (!field) {
    if (!validateGummyAuthoredPawn(snapshot))
      throw new Error('Invalid authored pawn snapshot')
    field = bakeAuthoredPawnVolume(
      snapshot.recipe,
      snapshot.seed,
      snapshot.thickness,
      snapshot.version,
    )
    if (volumes.size === 2) volumes.delete(volumes.keys().next().value!)
  } else volumes.delete(key)
  volumes.set(key, field)
  return field
}

/** Same continuous field drives particle occupancy, static mesh refinement and contact. */
export function authoredPawnField(
  point: Point,
  snapshot: GummyAuthoredPawn,
): number {
  if (!point.every(Number.isFinite))
    throw new RangeError('Authored pawn point must be finite')
  return createAuthoredPawnField(snapshot)(point)
}

/** Uniform occupied cells preserve material volume; IFS sampling density never becomes mass. */
export function sampleAuthoredPawn(
  snapshot: GummyAuthoredPawn,
  spacing: number,
  pinHeight: number,
): number[] {
  if (!range(spacing, 0.06, 0.12))
    throw new RangeError('Particle spacing must be between 0.06 and 0.12')
  if (!range(pinHeight, 0, 0.6))
    throw new RangeError('Particle pin height must be between zero and 0.6')
  const field = createAuthoredPawnField(snapshot)
  const points: number[] = []
  for (let iy = 0; (iy + 0.5) * spacing < BOUNDS.max[1]; iy++)
    for (
      let iz = Math.floor(BOUNDS.min[2] / spacing);
      (iz + 0.5) * spacing < BOUNDS.max[2];
      iz++
    )
      for (
        let ix = Math.floor(BOUNDS.min[0] / spacing);
        (ix + 0.5) * spacing < BOUNDS.max[0];
        ix++
      ) {
        const x = (ix + 0.5) * spacing,
          y = (iy + 0.5) * spacing,
          z = (iz + 0.5) * spacing
        if (field([x, y, z]) > 0) continue
        points.push(x, y, z, y < Math.min(pinHeight, 0.22) ? 0 : 1)
      }
  return points
}
