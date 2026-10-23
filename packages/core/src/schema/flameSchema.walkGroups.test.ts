/** Component identity persists through native JSON validation without defaults. */
import { describe, expect, it } from 'vitest'
import { renderSettingsDefault, tryValidateFlame, validateFlame, validateFlame3D, } from './flameSchema'
import type { TransformId } from './flameSchema'

const TRANSFORM = 'a' as TransformId

const makeFlame = (walkGroup?: unknown, dimensions: 2 | 3 = 3) => ({
  renderSettings: { ...renderSettingsDefault, dimensions },
  transforms: {
    a: {
      probability: 1,
      ...(walkGroup !== undefined && { walkGroup }),
      preAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
      postAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
      color: { x: 0, y: 0 },
      variations: { v: { type: 'linear3D', weight: 1 } },
    },
  },
})

describe('walkGroup metadata', () => {
  it('survives 3D JSON save/load and all native validation entry points', () => {
    const parsed = validateFlame(makeFlame('head_00'))
    expect(parsed.transforms[TRANSFORM]?.walkGroup).toBe('head_00')
    const json = JSON.parse(JSON.stringify(parsed))
    expect(validateFlame(json)).toEqual(parsed)
    expect(validateFlame3D(json).transforms[TRANSFORM]?.walkGroup).toBe(
      'head_00',
    )
    expect(tryValidateFlame(json)?.transforms[TRANSFORM]?.walkGroup).toBe(
      'head_00',
    )
  })

  it('keeps the metadata through temporary dimension switches', () => {
    expect(
      validateFlame(makeFlame('head_00', 2)).transforms[TRANSFORM]?.walkGroup,
    ).toBe('head_00')
  })

  it('adds no group property to an ordinary flame', () => {
    expect(validateFlame(makeFlame()).transforms[TRANSFORM]).not.toHaveProperty(
      'walkGroup',
    )
  })

  it.each(['', null, 17, {}, 'a'.repeat(129)])(
    'rejects invalid group metadata %j',
    (name) => {
      expect(tryValidateFlame(makeFlame(name))).toBeUndefined()
    },
  )

  it('accepts bounded opaque names, which are never shader identifiers', () => {
    for (const name of ['__proto__', 'face 01', 'x'.repeat(128)]) {
      expect(
        tryValidateFlame(makeFlame(name))?.transforms[TRANSFORM]?.walkGroup,
      ).toBe(name)
    }
  })
})
