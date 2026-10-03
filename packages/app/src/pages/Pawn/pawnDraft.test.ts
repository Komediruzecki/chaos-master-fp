/** Pawn drafts preserve shape controls and export a Library-readable flame. */
import { describe, expect, it } from 'vitest'
import { buildPawnFlame, DEFAULT_PAWN_RECIPE } from '@/flame/chess/pawnFlame'
import { parseFlameEnvelope } from '@/utils/flameImport'
import { createPawnDraft, parsePawnDraft, restorePawnDraft, serializePawnExport, } from './pawnDraft'
import type { PawnRecipe } from '@/flame/chess/pawnFlame'

const authored: PawnRecipe = {
  branchCount: 7,
  openness: 0.675,
  twist: -0.35,
  side: 'dark',
}

describe('Pawn Forge draft', () => {
  it('restores the authored shape and side after JSON storage', () => {
    const restored = parsePawnDraft(
      JSON.parse(JSON.stringify(createPawnDraft(authored))),
    )
    expect(restored).toEqual(authored)
    expect(restored).not.toBe(authored)
  })

  it('normalizes supported numeric ranges when reading a draft', () => {
    const restored = parsePawnDraft({
      ...createPawnDraft(authored),
      recipe: {
        branchCount: 99,
        openness: -2,
        twist: 10,
        side: 'dark',
      },
    })
    expect(restored).toEqual({
      branchCount: 8,
      openness: 0,
      twist: Math.PI,
      side: 'dark',
    })
  })

  it.each([
    null,
    [],
    {},
    authored,
    { ...createPawnDraft(authored), format: 'another-format' },
    { ...createPawnDraft(authored), version: 0 },
    { ...createPawnDraft(authored), version: 2 },
    { ...createPawnDraft(authored), recipe: [] },
    { ...createPawnDraft(authored), recipe: { ...authored, side: 'blue' } },
    { ...createPawnDraft(authored), recipe: { ...authored, openness: '0.5' } },
    { ...createPawnDraft(authored), recipe: { ...authored, twist: NaN } },
    {
      ...createPawnDraft(authored),
      recipe: { ...authored, branchCount: Infinity },
    },
  ])('refuses damaged or unsupported data %#', (raw) => {
    expect(parsePawnDraft(raw)).toBeUndefined()
    const restored = restorePawnDraft(raw)
    expect(restored).toEqual(DEFAULT_PAWN_RECIPE)
    expect(restored).not.toBe(DEFAULT_PAWN_RECIPE)
  })

  it('does not retain extra untrusted controls', () => {
    const restored = parsePawnDraft({
      ...createPawnDraft(authored),
      recipe: { ...authored, arbitraryVariation: 'anything' },
    })
    expect(restored).toEqual(authored)
  })
})

describe('Pawn Forge JSON export', () => {
  it('opens in the existing Library importer while retaining its recipe', () => {
    const raw: unknown = JSON.parse(serializePawnExport(authored))
    expect(parsePawnDraft(raw)).toEqual(authored)
    const imported = parseFlameEnvelope(raw)
    expect(imported?.flame).toEqual(buildPawnFlame(authored))
  })
})
