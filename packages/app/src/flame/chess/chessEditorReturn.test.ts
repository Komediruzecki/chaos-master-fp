/** Leaving the inspector restores authored editor data without fitting or stale-share overrides. */
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '@/utils/timeline'
import { IDENTITY_AFFINE } from '../clash/placement'
import { renderSettingsDefault, validateFlame } from '../schema/flameSchema'
import { createCustomVariation, deleteCustomVariation, updateCustomVariation, } from '../variations/custom/CustomVariationRegistry'
import { createChessCandidate } from './chessCandidate'
import { CHESS_EDITOR_RETURN_KEY, getChessEditorReturnUrl, isChessEditorReturn, loadChessEditorReturn, saveChessEditorReturn, } from './chessEditorReturn'
import type { TransformId, VariationId } from '../schema/flameSchema'
import type { TimelineSnapshot } from '../schema/timeline'

const ROOT = 'root' as TransformId
const SHAPE = 'shape' as VariationId

const timeline: TimelineSnapshot = {
  config: { ...defaultConfig(), fps: 60, endFrame: 240 },
  tracks: [
    {
      parameterPath: 'renderSettings.brightness',
      keyframes: [
        { frame: 0, value: 1 },
        { frame: 240, value: 2 },
      ],
    },
  ],
  currentFrame: 48,
  animationEnabled: false,
  autoKeyframe: true,
  previewHeld: true,
}

function source(type = 'linear3D') {
  return validateFlame({
    metadata: { name: 'Authored source' },
    renderSettings: { ...renderSettingsDefault, dimensions: 3 },
    transforms: {
      root: {
        probability: 1,
        preAffine: IDENTITY_AFFINE,
        postAffine: IDENTITY_AFFINE,
        color: { x: 0, y: 0 },
        variations: { shape: { type, weight: 1 } },
      },
    },
  })
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('chess inspection editor return', () => {
  it('round-trips the original flame and complete timeline, independently of candidate edits', () => {
    const candidate = createChessCandidate(source())
    saveChessEditorReturn(
      candidate,
      timeline,
      '/?s=original-share&quality=high#editor',
    )
    candidate.name = 'Fitted rook'
    candidate.role = 'rook'
    candidate.placement.scale = 0.3
    candidate.source.flame.metadata.name = 'Inspection edit'

    const url = getChessEditorReturnUrl()
    expect(url).toBe('/?s=original-share&quality=high&resume=chess#editor')
    expect(
      isChessEditorReturn(new URL(url, 'https://editor.invalid').search),
    ).toBe(true)
    const restored = loadChessEditorReturn(
      '?s=original-share&quality=high&resume=chess',
    )
    expect(restored?.flame).toEqual(source())
    expect(restored?.editorReturnTimeline).toEqual(timeline)
    expect(loadChessEditorReturn('?resume=chess')).toEqual(restored)
    expect(sessionStorage.getItem(CHESS_EDITOR_RETURN_KEY)).not.toBeNull()
  })

  it('does not open a return document during an ordinary editor visit', () => {
    saveChessEditorReturn(createChessCandidate(source()), timeline, '/')
    expect(
      loadChessEditorReturn('?flame=another-shared-document'),
    ).toBeUndefined()
    expect(isChessEditorReturn('?resume=other')).toBe(false)
    sessionStorage.clear()
    expect(getChessEditorReturnUrl()).toBe('/')
  })

  it('keeps corrupt data and reports it instead of silently loading another source', () => {
    sessionStorage.setItem(CHESS_EDITOR_RETURN_KEY, '{broken')
    expect(getChessEditorReturnUrl()).toBe('/?resume=chess')
    expect(() => loadChessEditorReturn('?resume=chess')).toThrow()
    expect(sessionStorage.getItem(CHESS_EDITOR_RETURN_KEY)).toBe('{broken')
  })

  it('validates timeline and same-app return addresses before overwriting a stored document', () => {
    const candidate = createChessCandidate(source())
    saveChessEditorReturn(candidate, timeline, '/')
    const previous = sessionStorage.getItem(CHESS_EDITOR_RETURN_KEY)
    expect(() => {
      saveChessEditorReturn(
        candidate,
        { ...timeline, currentFrame: Number.POSITIVE_INFINITY },
        '/',
      )
    }).toThrow('animation is invalid')
    for (const url of [
      '//other.example/',
      '/chess-forge',
      'javascript:alert(1)',
    ]) {
      expect(() => {
        saveChessEditorReturn(candidate, timeline, url)
      }).toThrow('address is invalid')
    }
    expect(sessionStorage.getItem(CHESS_EDITOR_RETURN_KEY)).toBe(previous)
  })

  it('reports return storage failure before departure', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => {
      saveChessEditorReturn(
        createChessCandidate(source()),
        timeline,
        '/',
        storage,
      )
    }).toThrow('Your flame is still open')
  })

  it('restores embedded custom code in root, hidden layers and blends after a library edit', () => {
    const made = createCustomVariation('Return test', 'return pos * 0.625;')
    if (!made.success) throw new Error('Could not create custom source')
    const flame = source(made.def.id)
    flame.layers = [
      {
        id: 'hidden',
        name: 'Hidden',
        visible: false,
        opacity: 0,
        blendMode: 'normal',
        transforms: source(made.def.id).transforms,
      },
    ]
    flame.renderSettings.blendFlame = source(made.def.id)
    saveChessEditorReturn(createChessCandidate(flame), timeline, '/')
    updateCustomVariation(made.def.id, 'return pos * 0.75;')
    const restored = loadChessEditorReturn('?resume=chess')
    if (!restored) throw new Error('Expected return document')
    const type = restored.flame.transforms[ROOT]!.variations[SHAPE]!.type
    expect(type).not.toBe(made.def.id)
    expect(
      restored.flame.layers![0]!.transforms[ROOT]!.variations[SHAPE]!.type,
    ).toBe(type)
    const recaptured = createChessCandidate(restored.flame)
    expect(recaptured.source.customVariations).toEqual([
      expect.objectContaining({ id: type, wgsl: 'return pos * 0.625;' }),
    ])
    expect(
      JSON.stringify(recaptured.source.flame.renderSettings.blendFlame),
    ).toContain(type)
    deleteCustomVariation(made.def.id)
  })
})
