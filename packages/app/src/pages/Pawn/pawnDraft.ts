/**
 * Versioned Pawn Forge recipes, restored without trusting browser storage.
 * The JSON export includes the generated flame so the editor's Library can
 * open the same file while Pawn Forge keeps its editable shape controls.
 */
import { buildPawnFlame, DEFAULT_PAWN_RECIPE, normalizePawnRecipe, } from '@/flame/chess/pawnFlame'
import type { PawnRecipe } from '@/flame/chess/pawnFlame'

export const PAWN_DRAFT_FORMAT = 'lumen-fractal-pawn'
export const PAWN_DRAFT_VERSION = 1

export type PawnDraft = {
  format: typeof PAWN_DRAFT_FORMAT
  version: typeof PAWN_DRAFT_VERSION
  recipe: PawnRecipe
}

export function createPawnDraft(recipe: PawnRecipe): PawnDraft {
  return {
    format: PAWN_DRAFT_FORMAT,
    version: PAWN_DRAFT_VERSION,
    recipe: normalizePawnRecipe(recipe),
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Unknown formats and versions are refused instead of misreading a recipe. */
export function parsePawnDraft(raw: unknown): PawnRecipe | undefined {
  const draft = objectRecord(raw)
  if (
    draft?.format !== PAWN_DRAFT_FORMAT ||
    draft.version !== PAWN_DRAFT_VERSION
  ) {
    return undefined
  }
  const recipe = objectRecord(draft.recipe)
  if (
    !recipe ||
    typeof recipe.branchCount !== 'number' ||
    !Number.isFinite(recipe.branchCount) ||
    typeof recipe.openness !== 'number' ||
    !Number.isFinite(recipe.openness) ||
    typeof recipe.twist !== 'number' ||
    !Number.isFinite(recipe.twist) ||
    (recipe.side !== 'light' && recipe.side !== 'dark')
  ) {
    return undefined
  }
  return normalizePawnRecipe({
    branchCount: recipe.branchCount,
    openness: recipe.openness,
    twist: recipe.twist,
    side: recipe.side,
  })
}

/** A damaged or obsolete local draft opens at the supported default. */
export function restorePawnDraft(raw: unknown): PawnRecipe {
  return parsePawnDraft(raw) ?? normalizePawnRecipe(DEFAULT_PAWN_RECIPE)
}

export function serializePawnExport(recipe: PawnRecipe): string {
  const draft = createPawnDraft(recipe)
  return JSON.stringify(
    { ...draft, flame: buildPawnFlame(draft.recipe) },
    null,
    2,
  )
}
