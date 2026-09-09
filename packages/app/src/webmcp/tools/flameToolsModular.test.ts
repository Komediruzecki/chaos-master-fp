import { describe, expect, it } from 'vitest'
import { formatSummarizedMetadata, formatSummarizedRenderSettings, formatSummarizedTransforms, formatTransformSummary, } from './getFlame'
import { resolveTransformDetail } from './getFlameDetail'
import { openArena } from './openArena'
import type { TransformFunction } from '@/flame/schema/flameSchema'

describe('getFlame modular subroutines', () => {
  it('formats transform summary correctly', () => {
    const t = {
      probability: 0.8,
      variations: {
        linearVar: { type: 'linearVar', weight: 1.0 },
      },
      color: { x: 0.2, y: 0.8 },
      colorSpeed: 0.5,
      visible: true,
    } as unknown as TransformFunction

    const summary = formatTransformSummary('t0', t)
    expect(summary.id).toBe('t0')
    expect(summary.probability).toBe(0.8)
    expect(summary.variations).toEqual([{ type: 'linearVar', weight: 1.0 }])
    expect(summary.color).toEqual({ x: 0.2, y: 0.8 })
    expect(summary.colorSpeed).toBe(0.5)
    expect(summary.visible).toBe(true)
  })

  it('formats summarized transforms and tracks truncation', () => {
    const record: Record<string, TransformFunction> = {}
    for (let i = 0; i < 10; i++) {
      record[`t_${i}`] = {
        probability: 1,
        variations: {},
        visible: true,
      } as unknown as TransformFunction
    }

    const res = formatSummarizedTransforms(record)
    expect(res.transformCount).toBe(10)
    expect(res.truncated).toBe(true)
    expect(res.transforms.length).toBe(8)
  })

  it('formats summarized render settings including 3D camera', () => {
    const rs = formatSummarizedRenderSettings({
      dimensions: 3,
      camera3D: {
        theta: 1,
        phi: 2,
        radius: 5,
        target: [0, 0, 0],
        fov: 60,
        roll: 0,
      },
      exposure: 0.4,
    })

    expect(rs.dimensions).toBe(3)
    expect(rs.camera3D).toBeDefined()
    expect(rs.camera3D?.radius).toBe(5)
    expect(rs.exposure).toBe(0.4)
  })

  it('formats metadata with defaults', () => {
    expect(formatSummarizedMetadata(undefined)).toEqual({
      name: '',
      author: 'unknown',
      description: '',
    })
    expect(
      formatSummarizedMetadata({
        name: 'My Flame',
        author: 'Artist',
        description: 'Test',
      }),
    ).toEqual({
      name: 'My Flame',
      author: 'Artist',
      description: 'Test',
    })
  })
})

describe('getFlameDetail modular subroutines', () => {
  const transforms = {
    t_alpha: {
      probability: 0.5,
      variations: { juliaVar: { type: 'juliaVar', weight: 1 } },
    } as unknown as TransformFunction,
    t_beta: {
      probability: 0.8,
      variations: { sphericalVar: { type: 'sphericalVar', weight: 1 } },
    } as unknown as TransformFunction,
  }

  it('resolves transform detail by string id', () => {
    const res = resolveTransformDetail(transforms, 't_alpha')
    expect('transform' in res).toBe(true)
    if ('transform' in res && res.transform) {
      expect(res.transformId).toBe('t_alpha')
      expect(res.transform.probability).toBe(0.5)
    }
  })

  it('resolves transform detail by numeric index', () => {
    const res = resolveTransformDetail(transforms, 1)
    expect('transform' in res).toBe(true)
    if ('transform' in res && res.transform) {
      expect(res.transformId).toBe('t_beta')
      expect(res.index).toBe(1)
    }
  })

  it('returns error when transform target is invalid or missing', () => {
    expect(resolveTransformDetail(transforms, undefined)).toHaveProperty(
      'error',
    )
    expect(resolveTransformDetail(transforms, 'non_existent')).toHaveProperty(
      'error',
    )
  })
})

describe('openArena tool execution contract', () => {
  it('returns error when workspace context or arena is not available', () => {
    const res = openArena.execute({}, {}) as { error: string }
    expect(res.error).toBeDefined()
  })
})
