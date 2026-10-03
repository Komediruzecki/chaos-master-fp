/** Independent pawn families and versioned drafts preserve the original echo recipe. */
import { buildPawnFlame, DEFAULT_PAWN_RECIPE, normalizePawnRecipe, } from '@/flame/chess/pawnFlame'
import { buildStructuralPawnFlame, DEFAULT_STRUCTURAL_PAWN_RECIPE, } from '@/flame/chess/structuralPawnFlame'
import { createPawnDraft, parsePawnDraft, serializePawnExport, } from './pawnDraft'
import type { PawnRecipe } from '@/flame/chess/pawnFlame'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

export type PawnForm = 'echo' | 'lattice'
export type PawnDesign = {
  selected: PawnForm
  recipes: Record<PawnForm, PawnRecipe>
}

export const PAWN_DESIGN_FORMAT = 'lumen-pawn-experiments'
export const PAWN_DESIGN_VERSION = 1
export const STRUCTURAL_PAWN_GENERATOR = 'structural-pawn'
export const STRUCTURAL_PAWN_VERSION = 1

/** The old draft is copied into the comparison without changing its storage key. */
export function createPawnDesign(legacyDraft?: unknown): PawnDesign {
  return {
    selected: 'lattice',
    recipes: {
      echo:
        parsePawnDraft(legacyDraft) ?? normalizePawnRecipe(DEFAULT_PAWN_RECIPE),
      lattice: normalizePawnRecipe(DEFAULT_STRUCTURAL_PAWN_RECIPE),
    },
  }
}

export function createPawnDesignDraft(design: PawnDesign) {
  return {
    format: PAWN_DESIGN_FORMAT,
    version: PAWN_DESIGN_VERSION,
    selected: design.selected,
    recipes: {
      echo: createPawnDraft(design.recipes.echo),
      lattice: {
        generator: STRUCTURAL_PAWN_GENERATOR,
        generatorVersion: STRUCTURAL_PAWN_VERSION,
        recipe: normalizePawnRecipe(design.recipes.lattice),
      },
    },
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function parsePawnDesignDraft(raw: unknown): PawnDesign | undefined {
  const draft = objectRecord(raw)
  if (
    draft?.format !== PAWN_DESIGN_FORMAT ||
    draft.version !== PAWN_DESIGN_VERSION ||
    (draft.selected !== 'echo' && draft.selected !== 'lattice')
  )
    return undefined
  const recipes = objectRecord(draft.recipes)
  const echo = parsePawnDraft(recipes?.echo)
  const lattice = parseStructuralRecipe(recipes?.lattice)
  if (!echo || !lattice) return undefined
  return { selected: draft.selected, recipes: { echo, lattice } }
}

function parseStructuralRecipe(raw: unknown): PawnRecipe | undefined {
  const structural = objectRecord(raw)
  if (
    structural?.generator !== STRUCTURAL_PAWN_GENERATOR ||
    structural.generatorVersion !== STRUCTURAL_PAWN_VERSION
  )
    return undefined
  // Reuse the strict finite-control parser without assigning echo generator semantics.
  return parsePawnDraft({
    ...createPawnDraft(DEFAULT_PAWN_RECIPE),
    recipe: structural.recipe,
  })
}

export function restorePawnDesignDraft(
  raw: unknown,
  legacyDraft?: unknown,
): PawnDesign {
  const supported = parsePawnDesignDraft(raw)
  if (supported) return supported
  const fallback = createPawnDesign(legacyDraft)
  const draft = objectRecord(raw)
  if (
    draft?.format !== PAWN_DESIGN_FORMAT ||
    draft.version !== PAWN_DESIGN_VERSION
  )
    return fallback
  const recipes = objectRecord(draft.recipes)
  return {
    selected: draft.selected === 'echo' ? 'echo' : 'lattice',
    recipes: {
      echo: parsePawnDraft(recipes?.echo) ?? fallback.recipes.echo,
      lattice:
        parseStructuralRecipe(recipes?.lattice) ?? fallback.recipes.lattice,
    },
  }
}

export function buildPawnDesignFlame(
  form: PawnForm,
  recipe: PawnRecipe,
): FlameDescriptor {
  return form === 'echo'
    ? buildPawnFlame(recipe)
    : buildStructuralPawnFlame(recipe)
}

/** Echo exports retain V1 semantics; structural exports identify their own generator. */
export function serializePawnDesignExport(
  form: PawnForm,
  recipe: PawnRecipe,
): string {
  if (form === 'echo') return serializePawnExport(recipe)
  const normalized = normalizePawnRecipe(recipe)
  return JSON.stringify(
    {
      format: 'lumen-fractal-pawn-design',
      version: 1,
      generator: {
        id: STRUCTURAL_PAWN_GENERATOR,
        version: STRUCTURAL_PAWN_VERSION,
      },
      recipe: normalized,
      flame: buildStructuralPawnFlame(normalized),
    },
    null,
    2,
  )
}
