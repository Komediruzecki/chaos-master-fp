import { describe, expect, it } from 'vitest'
import { IDENTITY_AFFINE } from '../clash/placement'
import { renderSettingsDefault, validateFlame } from '../schema/flameSchema'
import { transformVariations } from '../variations'
import { createCustomVariation, deleteCustomVariation, getCustomVariations, isCustomVariationRegistered, updateCustomVariation, } from '../variations/custom/CustomVariationRegistry'
import { createChessCandidate } from './chessCandidate'
import { createChessCandidateVariations } from './chessCandidateVariations'
import type { TransformId, VariationId } from '../schema/flameSchema'

const ROOT = 'root' as TransformId
const V0 = 'v0' as VariationId
const V1 = 'v1' as VariationId

function flameWith(types: string[]) {
  return validateFlame({
    renderSettings: { ...renderSettingsDefault, dimensions: 3 },
    transforms: {
      root: {
        probability: 1,
        preAffine: IDENTITY_AFFINE,
        postAffine: IDENTITY_AFFINE,
        color: { x: 0, y: 0 },
        variations: Object.fromEntries(
          types.map((type, index) => [`v${index}`, { type, weight: 1 }]),
        ),
      },
    },
  })
}

describe('owned chess candidate custom rendering', () => {
  it('registers isolated code, recursively remaps without mutation, and releases only its registrations', async () => {
    const result = createCustomVariation(
      'Owned test source',
      'return pos * 0.625;',
    )
    if (!result.success) throw new Error('Could not create test variation')
    const source = flameWith([result.def.id])
    source.layers = [
      {
        id: 'hidden',
        name: 'Hidden',
        visible: false,
        opacity: 0,
        blendMode: 'normal',
        transforms: flameWith([result.def.id]).transforms,
      },
    ]
    source.renderSettings.blendFlame = flameWith([result.def.id])
    const candidate = createChessCandidate(source)
    const libraryBefore = getCustomVariations().map((def) => def.id)
    const prepared = await createChessCandidateVariations(candidate)
    const isolated = prepared.flame.transforms[ROOT]!.variations[V0]!.type
    expect(isolated).not.toBe(result.def.id)
    expect(isCustomVariationRegistered(isolated)).toBe(true)
    expect(
      prepared.flame.layers![0]!.transforms[ROOT]!.variations[V0]!.type,
    ).toBe(isolated)
    expect(candidate.source.flame.transforms[ROOT]!.variations[V0]!.type).toBe(
      result.def.id,
    )
    expect(getCustomVariations().map((def) => def.id)).toEqual(libraryBefore)
    const isolatedFn = transformVariations[isolated]!.fn
    updateCustomVariation(result.def.id, 'return pos * 0.75;')
    expect(transformVariations[isolated]!.fn).toBe(isolatedFn)
    expect(transformVariations[result.def.id]!.fn).not.toBe(isolatedFn)
    prepared.dispose()
    prepared.dispose()
    expect(isCustomVariationRegistered(isolated)).toBe(false)
    expect(isCustomVariationRegistered(result.def.id)).toBe(true)
    deleteCustomVariation(result.def.id)
  })

  it('rolls back earlier registrations if a later stored definition cannot compile', async () => {
    const created = createCustomVariation(
      'Rollback source',
      'return pos * 0.375;',
    )
    if (!created.success) throw new Error('Could not create test variation')
    const candidate = createChessCandidate(flameWith([created.def.id]))
    candidate.source.flame.transforms[ROOT]!.variations[V1] = {
      type: 'custom_candidate_invalid',
      weight: 1,
      visible: true,
    }
    candidate.source.customVariations.push({
      id: 'custom_candidate_invalid',
      name: 'Invalid code',
      wgsl: 'return textureSample(pos);',
      createdAt: 0,
      updatedAt: 0,
    })
    const registeredBefore = Object.keys(transformVariations)
    await expect(createChessCandidateVariations(candidate)).rejects.toThrow(
      'could not compile',
    )
    expect(Object.keys(transformVariations)).toEqual(registeredBefore)
    deleteCustomVariation(created.def.id)
  })
})
