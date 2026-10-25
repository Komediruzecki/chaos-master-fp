/** Comparison drafts and exports keep echo and structural generator semantics separate. */
import { describe, expect, it } from 'vitest'
import { buildPawnFlame } from '@/flame/chess/pawnFlame'
import { DEFAULT_STRUCTURAL_PAWN_RECIPE } from '@/flame/chess/structuralPawnFlame'
import { parseFlameEnvelope } from '@/utils/flameImport'
import { buildPawnDesignFlame, createPawnDesign, createPawnDesignDraft, parsePawnDesignDraft, restorePawnDesignDraft, serializePawnDesignExport, } from './pawnDesign'
import { createPawnDraft, serializePawnExport } from './pawnDraft'

const legacyRecipe = {
  branchCount: 4,
  openness: 0.8,
  twist: -0.7,
  side: 'dark' as const,
}
const structuralRecipe = {
  branchCount: 8,
  openness: 0.6,
  twist: 0.5,
  side: 'light' as const,
}

describe('Pawn form comparison', () => {
  it('copies a valid legacy draft without changing its shape or generator', () => {
    const legacy = createPawnDraft(legacyRecipe)
    const before = JSON.stringify(legacy)
    const design = createPawnDesign(legacy)
    expect(design.selected).toBe('lattice')
    expect(design.recipes.echo).toEqual(legacyRecipe)
    expect(design.recipes.lattice).toEqual(DEFAULT_STRUCTURAL_PAWN_RECIPE)
    expect(design.recipes.echo).not.toBe(legacy.recipe)
    expect(JSON.stringify(legacy)).toBe(before)
    expect(buildPawnDesignFlame('echo', design.recipes.echo)).toEqual(
      buildPawnFlame(legacyRecipe),
    )
  })

  it('round-trips separate controls and selected form through storage', () => {
    const design = createPawnDesign(createPawnDraft(legacyRecipe))
    design.recipes.lattice = structuralRecipe
    design.selected = 'echo'
    const restored = parsePawnDesignDraft(
      JSON.parse(JSON.stringify(createPawnDesignDraft(design))),
    )
    expect(restored).toEqual(design)
    expect(restored?.recipes.echo).not.toBe(design.recipes.echo)
    expect(restored?.recipes.lattice).not.toBe(design.recipes.lattice)
  })

  it.each([
    null,
    [],
    {},
    { ...createPawnDesignDraft(createPawnDesign()), version: 2 },
    {
      ...createPawnDesignDraft(createPawnDesign()),
      recipes: {
        echo: createPawnDraft(legacyRecipe),
        lattice: createPawnDraft(structuralRecipe),
      },
    },
    {
      ...createPawnDesignDraft(createPawnDesign()),
      recipes: {
        echo: createPawnDraft(legacyRecipe),
        lattice: {
          generator: 'structural-pawn',
          generatorVersion: 2,
          recipe: structuralRecipe,
        },
      },
    },
    {
      ...createPawnDesignDraft(createPawnDesign()),
      recipes: {
        echo: createPawnDraft(legacyRecipe),
        lattice: {
          generator: 'structural-pawn',
          generatorVersion: 1,
          recipe: { ...structuralRecipe, twist: NaN },
        },
      },
    },
  ])(
    'rejects unknown or damaged comparison data %# while recovering the original',
    (raw) => {
      expect(parsePawnDesignDraft(raw)).toBeUndefined()
      expect(
        restorePawnDesignDraft(raw, createPawnDraft(legacyRecipe)).recipes.echo,
      ).toEqual(legacyRecipe)
    },
  )

  it('retains valid family controls when only the selected form is unknown', () => {
    const design = createPawnDesign(createPawnDraft(legacyRecipe))
    design.recipes.lattice = structuralRecipe
    const raw = { ...createPawnDesignDraft(design), selected: 'unknown' }
    expect(parsePawnDesignDraft(raw)).toBeUndefined()
    expect(restorePawnDesignDraft(raw).recipes).toEqual(design.recipes)
    expect(restorePawnDesignDraft(raw).selected).toBe('lattice')
  })

  it('keeps original export bytes and V1 interpretation unchanged', () => {
    expect(serializePawnDesignExport('echo', legacyRecipe)).toBe(
      serializePawnExport(legacyRecipe),
    )
  })

  it('recovers each family independently when the other generator is damaged or unsupported', () => {
    const design = createPawnDesign(createPawnDraft(legacyRecipe))
    const editedEcho = { ...legacyRecipe, branchCount: 7, openness: 0.2 }
    design.recipes.echo = editedEcho
    design.recipes.lattice = structuralRecipe
    design.selected = 'echo'
    const draft = createPawnDesignDraft(design)
    const badLattice = {
      ...draft,
      recipes: {
        ...draft.recipes,
        lattice: { ...draft.recipes.lattice, generatorVersion: 99 },
      },
    }
    const recoveredEcho = restorePawnDesignDraft(
      badLattice,
      createPawnDraft(legacyRecipe),
    )
    expect(recoveredEcho.selected).toBe('echo')
    expect(recoveredEcho.recipes.echo).toEqual(editedEcho)
    expect(recoveredEcho.recipes.lattice).toEqual(
      DEFAULT_STRUCTURAL_PAWN_RECIPE,
    )

    const badEcho = {
      ...draft,
      recipes: {
        ...draft.recipes,
        echo: { ...draft.recipes.echo, version: 99 },
      },
    }
    const recoveredLattice = restorePawnDesignDraft(
      badEcho,
      createPawnDraft(legacyRecipe),
    )
    expect(recoveredLattice.recipes.echo).toEqual(legacyRecipe)
    expect(recoveredLattice.recipes.lattice).toEqual(structuralRecipe)
  })

  it('exports a versioned structural generator and Library-readable grouped flame', () => {
    const raw: unknown = JSON.parse(
      serializePawnDesignExport('lattice', structuralRecipe),
    )
    expect(raw).toMatchObject({
      generator: { id: 'structural-pawn', version: 1 },
      recipe: structuralRecipe,
    })
    const imported = parseFlameEnvelope(raw)
    expect(imported?.flame).toEqual(
      buildPawnDesignFlame('lattice', structuralRecipe),
    )
    expect(
      Object.values(imported?.flame.transforms ?? {}).every(
        (transform) => 'walkGroup' in transform,
      ),
    ).toBe(true)
  })
})
