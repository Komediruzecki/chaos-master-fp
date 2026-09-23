/**
 * The two Flame Clash fields of the flame schema: `team` on a transform and
 * `renderSettings.clash`. A fight flame keeps them through validation, and a
 * flame without them comes out without them, so no saved flame changes shape.
 */
import { describe, expect, it } from 'vitest'
import { renderSettingsDefault, tryValidateFlame, validateFlame, } from './flameSchema'

const transform = (team?: string) => ({
  probability: 1,
  preAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
  postAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
  color: { x: 0, y: 0 },
  ...(team !== undefined && { team }),
  variations: { v1: { type: 'linearVar', weight: 1 } },
})

const flame = (
  dimensions: 2 | 3,
  teams: [string?, string?] = [],
  clash?: Record<string, number>,
) => ({
  renderSettings: {
    ...renderSettingsDefault,
    dimensions,
    ...(clash && { clash }),
  },
  transforms: { a1: transform(teams[0]), b1: transform(teams[1]) },
})

describe.each([2, 3] as const)('the %dD flame schema', (dimensions) => {
  it('keeps the teams and the fight uniforms of a fight flame', () => {
    const clash = { split: 0.8, leakA: 0.2, leakB: 0 }
    const parsed = validateFlame(flame(dimensions, ['A', 'B'], clash))
    expect(parsed.transforms['a1' as never]?.team).toBe('A')
    expect(parsed.transforms['b1' as never]?.team).toBe('B')
    expect(parsed.renderSettings.clash).toEqual(clash)
  })

  it('adds neither field to a flame without them', () => {
    const parsed = validateFlame(flame(dimensions))
    expect(parsed.renderSettings).not.toHaveProperty('clash')
    for (const t of Object.values(parsed.transforms)) {
      expect(t).not.toHaveProperty('team')
    }
  })

  it('refuses a team other than A or B', () => {
    expect(tryValidateFlame(flame(dimensions, ['A', 'C']))).toBeUndefined()
  })

  it('refuses fight uniforms outside 0..1 or incomplete', () => {
    const bad: Record<string, number>[] = [
      { split: 1.2, leakA: 0, leakB: 0 },
      { split: 0.5, leakA: -0.1, leakB: 0 },
      { split: 0.5, leakA: 0 },
    ]
    for (const clash of bad) {
      expect(tryValidateFlame(flame(dimensions, [], clash))).toBeUndefined()
    }
  })
})
