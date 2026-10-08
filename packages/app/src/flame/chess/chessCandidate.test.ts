import { createStore } from 'solid-js/store'
import { describe, expect, it } from 'vitest'
import { applyAffine, IDENTITY_AFFINE } from '../clash/placement'
import { renderSettingsDefault, validateFlame } from '../schema/flameSchema'
import { createCustomVariation, deleteCustomVariation, importSharedVariations, updateCustomVariation, } from '../variations/custom/CustomVariationRegistry'
import { candidateRenderFlame, CHESS_CANDIDATE_JSON_LIMIT, chessCandidatePlacementAffine, createChessCandidate, forEachChessCandidateTransform, parseChessCandidate, serializeChessCandidate, validateChessCandidate, } from './chessCandidate'
import type { FlameDescriptor, TransformId, VariationId, } from '../schema/flameSchema'

const ROOT = 'root' as TransformId
const SHAPE = 'shape' as VariationId

function nativeFlame(type = 'linear3D'): FlameDescriptor {
  return validateFlame({
    metadata: { name: 'Native source' },
    renderSettings: {
      ...renderSettingsDefault,
      dimensions: 3,
      pointInitMode: 'pointInitUnitBall',
    },
    transforms: {
      root: {
        probability: 1,
        preAffine: IDENTITY_AFFINE,
        postAffine: IDENTITY_AFFINE,
        color: { x: 0.2, y: 0.8 },
        variations: { shape: { type, weight: 1 } },
      },
    },
  })
}

describe('chess candidate native source snapshots', () => {
  it('clones a live editor proxy before schema migrations and refuses circular blend graphs', () => {
    const source = nativeFlame()
    source.transforms[ROOT]!.variations[SHAPE]!.type = 'linear'
    const [editor] = createStore(source)
    const candidate = createChessCandidate(editor)
    expect(
      candidate.source.flame.transforms[ROOT]!.variations[SHAPE]!.type,
    ).toBe('linearVar')
    expect(editor.transforms[ROOT]!.variations[SHAPE]!.type).toBe('linear')
    source.renderSettings.blendFlame = source
    expect(() => createChessCandidate(source)).toThrow('circular references')
  })

  it('round trips hidden transforms, palette, layers, blends and fit without sharing editor data', () => {
    const source = nativeFlame()
    source.transforms[ROOT]!.visible = false
    source.layers = [
      {
        id: 'layer',
        name: 'Stored layer',
        visible: false,
        opacity: 0.4,
        blendMode: 'screen',
        transforms: nativeFlame().transforms,
      },
    ]
    source.renderSettings.blendFlame = nativeFlame()
    source.renderSettings.blendWeight = 0.35
    source.renderSettings.palette = {
      id: 'test',
      name: 'Test palette',
      entries: [{ id: 'a', position: 0, a: 0.2, b: -0.1 }],
    }
    const snapshot = createChessCandidate(source)
    snapshot.role = 'bishop'
    snapshot.placement = {
      rotation: [0.1, 0.2, 0.3],
      scale: 2,
      offset: [1, 2, 3],
    }
    const restored = parseChessCandidate(serializeChessCandidate(snapshot))
    expect(restored).toEqual(snapshot)
    source.transforms[ROOT]!.variations[SHAPE]!.weight = 9
    source.layers[0]!.opacity = 0.9
    expect(
      restored.source.flame.transforms[ROOT]!.variations[SHAPE]!.weight,
    ).toBe(1)
    expect(restored.source.flame.layers![0]!.opacity).toBe(0.4)
    expect(restored.source.flame.transforms[ROOT]!.visible).toBe(false)
    expect(restored.source.flame.renderSettings.palette).toEqual({
      id: 'test',
      name: 'Test palette',
      entries: [{ id: 'a', position: 0, a: 0.2, b: -0.1 }],
    })
  })

  it('captures saved and transient custom definitions in hidden layers and nested blends', () => {
    const saved = createCustomVariation(
      'Candidate saved',
      'return pos + vec2f(0.125, 0.0);',
    )
    if (!saved.success) throw new Error('Could not create test variation')
    const shared = importSharedVariations([
      {
        id: 'custom_candidate_shared',
        name: 'Shared candidate',
        wgsl: 'return pos * 0.875;',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const sharedId =
      shared.remap.custom_candidate_shared ?? 'custom_candidate_shared'
    const source = nativeFlame()
    source.layers = [
      {
        id: 'hidden',
        name: 'Hidden',
        visible: false,
        opacity: 0,
        blendMode: 'normal',
        transforms: nativeFlame(saved.def.id).transforms,
      },
    ]
    source.renderSettings.blendFlame = nativeFlame(sharedId)
    const candidate = createChessCandidate(source)
    expect(
      candidate.source.customVariations.map((def) => def.id).sort(),
    ).toEqual([saved.def.id, sharedId].sort())
    updateCustomVariation(saved.def.id, 'return pos * 0.5;')
    expect(
      candidate.source.customVariations.find((def) => def.id === saved.def.id)!
        .wgsl,
    ).toBe('return pos + vec2f(0.125, 0.0);')
    deleteCustomVariation(saved.def.id)
    expect(parseChessCandidate(serializeChessCandidate(candidate))).toEqual(
      candidate,
    )
  })

  it('does not allow missing, duplicate or unrelated custom definitions', () => {
    expect(() => createChessCandidate(nativeFlame('custom_missing'))).toThrow(
      'missing custom variations: custom_missing',
    )
    const candidate = createChessCandidate(nativeFlame())
    const def = {
      id: 'custom_extra',
      name: 'Extra',
      wgsl: 'return pos;',
      createdAt: 0,
      updatedAt: 0,
    }
    expect(() =>
      validateChessCandidate({
        ...candidate,
        source: { ...candidate.source, customVariations: [def] },
      }),
    ).toThrow('not used')
    candidate.source.flame.transforms[ROOT]!.variations[SHAPE]!.type = def.id
    expect(() =>
      validateChessCandidate({
        ...candidate,
        source: { ...candidate.source, customVariations: [def, def] },
      }),
    ).toThrow('unique')
  })

  it('rejects non-finite source values before JSON can erase them and never mutates the input', () => {
    const source = nativeFlame()
    source.transforms[ROOT]!.variations[SHAPE]!.weight = Infinity
    expect(() => createChessCandidate(source)).toThrow('finite numbers')
    expect(source.transforms[ROOT]!.variations[SHAPE]!.weight).toBe(Infinity)
    source.transforms[ROOT]!.variations[SHAPE]!.weight = 1
    source.renderSettings.blendFlame = {
      ...nativeFlame(),
      finalTransform: { ...IDENTITY_AFFINE, a: NaN },
    }
    expect(() => createChessCandidate(source)).toThrow('finite numbers')
  })

  it('bounds combined layers and nested blends instead of counting only root transforms', () => {
    const source = nativeFlame()
    const many = Object.fromEntries(
      Array.from({ length: 128 }, (_, index) => [
        `t${index}`,
        nativeFlame().transforms[ROOT]!,
      ]),
    )
    source.layers = [
      {
        id: 'many',
        name: 'Many',
        visible: false,
        opacity: 0,
        blendMode: 'normal',
        transforms: many,
      },
    ]
    expect(() => createChessCandidate(source)).toThrow('Combined chess source')
    const nested = nativeFlame()
    let current = nested
    for (let index = 0; index < 5; index++) {
      const next = nativeFlame()
      current.renderSettings.blendFlame = next
      current = next
    }
    expect(() => createChessCandidate(nested)).toThrow('too many nested blends')
  })

  it('rejects corrupt adapters, unsupported envelopes and oversized JSON without coercion', () => {
    const candidate = createChessCandidate(nativeFlame())
    expect(() => validateChessCandidate({ ...candidate, version: 2 })).toThrow(
      'not supported',
    )
    expect(() =>
      validateChessCandidate({ ...candidate, role: 'dragon' }),
    ).toThrow('chess role')
    expect(() =>
      validateChessCandidate({
        ...candidate,
        placement: { ...candidate.placement, scale: 0 },
      }),
    ).toThrow('scale')
    expect(() =>
      validateChessCandidate({
        ...candidate,
        placement: { ...candidate.placement, rotation: [0, 0] },
      }),
    ).toThrow('Rotation')
    expect(() =>
      parseChessCandidate(' '.repeat(CHESS_CANDIDATE_JSON_LIMIT + 1)),
    ).toThrow('too large')
  })

  it('places output after the authored final transform while preserving source maps and blend placement', () => {
    const source = nativeFlame('swirl3D')
    source.finalTransform = { ...IDENTITY_AFFINE, d: 2 }
    const blend = nativeFlame()
    blend.finalTransform = { ...IDENTITY_AFFINE, d: 1 }
    source.renderSettings.blendFlame = blend
    const candidate = createChessCandidate(source)
    candidate.placement = {
      rotation: [0, 0, Math.PI / 2],
      scale: 2,
      offset: [0, 3, 0],
    }
    const rendered = candidateRenderFlame(candidate)
    const position = applyAffine(
      rendered.finalTransform as typeof IDENTITY_AFFINE,
      [0, 0, 0],
    )
    expect(position[0]).toBeCloseTo(0)
    expect(position[1]).toBeCloseTo(7)
    const blendPosition = applyAffine(
      (rendered.renderSettings.blendFlame as FlameDescriptor)
        .finalTransform as typeof IDENTITY_AFFINE,
      [0, 0, 0],
    )
    expect(blendPosition[1]).toBeCloseTo(5)
    expect(rendered.transforms).toEqual(source.transforms)
    expect(candidate.source.flame.finalTransform).toEqual({
      ...IDENTITY_AFFINE,
      d: 2,
    })
  })

  it('applies X then Y then Z rotations and leaves flat source interpretation untouched', () => {
    const placement = {
      rotation: [Math.PI / 2, Math.PI / 2, 0] as [number, number, number],
      scale: 1,
      offset: [0, 0, 0] as [number, number, number],
    }
    const position = applyAffine(
      chessCandidatePlacementAffine(placement),
      [0, 1, 0],
    )
    expect(position[0]).toBeCloseTo(1)
    expect(position[1]).toBeCloseTo(0)
    expect(position[2]).toBeCloseTo(0)
    const flat = validateFlame({
      transforms: {},
      renderSettings: { ...renderSettingsDefault, dimensions: 2 },
    })
    const candidate = createChessCandidate(flat)
    candidate.placement = placement
    expect(candidateRenderFlame(candidate)).toEqual(flat)
  })

  it('walks every stored map once including inactive maps and nested blend layers', () => {
    const source = nativeFlame()
    const blend = nativeFlame('curl3D')
    blend.layers = [
      {
        id: 'layer',
        name: 'Layer',
        visible: false,
        opacity: 0,
        blendMode: 'normal',
        transforms: nativeFlame('swirl3D').transforms,
      },
    ]
    source.renderSettings.blendFlame = blend
    const types: string[] = []
    forEachChessCandidateTransform(source, (transform) =>
      types.push(transform.variations[SHAPE]!.type),
    )
    expect(types).toEqual(['linear3D', 'curl3D', 'swirl3D'])
  })
})
