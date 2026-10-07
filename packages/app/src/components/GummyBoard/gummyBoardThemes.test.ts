/** Theme codes and the analytic slab preserve board geometry and finite grazing hits. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { gummyBoardBevelHit, gummyBoardGlassSupportHit, gummyBoardLavaSite, gummyBoardStageLighting, gummyBoardStageMaterial, gummyBoardStudioFloor, gummyBoardTileColour, } from './gummyBoardStageShaders'
import { GUMMY_BOARD_GLASS_FLOOR, gummyBoardThemeCode, } from './gummyBoardThemes'
import type { GummyBoardTheme } from './gummyBoardThemes'

describe('gummy board stage themes', () => {
  it('mixes both cell coordinates so lava sites cannot form a rectangular grid', () => {
    const origin = gummyBoardLavaSite(d.vec2f(0, 0))
    const row = gummyBoardLavaSite(d.vec2f(0, 1))
    const column = gummyBoardLavaSite(d.vec2f(1, 0))
    expect(origin.x).not.toBeCloseTo(row.x, 4)
    expect(origin.y).not.toBeCloseTo(column.y, 4)
    for (let x = -4; x < 4; x++) {
      for (let y = -4; y < 4; y++) {
        const site = gummyBoardLavaSite(d.vec2f(x, y))
        expect(site.x).toBeGreaterThanOrEqual(x + 0.099)
        expect(site.x).toBeLessThanOrEqual(x + 0.901)
        expect(site.y).toBeGreaterThanOrEqual(y + 0.099)
        expect(site.y).toBeLessThanOrEqual(y + 0.901)
      }
    }
  })
  it('supports the slab above the receiver while leaving the central air gap open', () => {
    const foot = gummyBoardGlassSupportHit(
      d.vec3f(5.9, -0.4, 7),
      d.vec3f(0, 0, -1),
    )
    expect(foot.w).toBeCloseTo(0.91, 5)
    expect(
      gummyBoardGlassSupportHit(d.vec3f(0, -0.4, 7), d.vec3f(0, 0, -1)).w,
    ).toBe(-1)
    expect(GUMMY_BOARD_GLASS_FLOOR).toBeLessThan(-0.32)
    const contact = gummyBoardGlassSupportHit(
      d.vec3f(5.9, -0.3195, 5.9),
      d.vec3f(0, -1, 0),
    )
    expect(contact.w).toBeCloseTo(0.0005, 6)
    expect(contact.y).toBe(1)
  })
  it('preserves classic floor transport while restraining themed caustics without bleaching their hue', () => {
    const base = d.vec3f(0.4, 0.3, 0.2)
    const light = d.vec4f(0.8, 0.4, 0.1, 0.8)
    const classic = gummyBoardStageLighting(base, light, 0)
    for (const [index, expected] of [0.92, 0.565, 0.21].entries())
      expect(classic[index]).toBeCloseTo(expected, 6)
    const caustic = gummyBoardStageLighting(
      d.vec3f(0),
      d.vec4f(20, 10, 5, 0),
      1,
    )
    expect(caustic.x).toBeLessThan(0.2)
    expect(caustic.x / caustic.y).toBeCloseTo(2)
    expect(caustic.y / caustic.z).toBeCloseTo(2)
    expect(gummyBoardStageLighting(base, d.vec4f(0, 0, 0, 1), 2).x).toBeCloseTo(
      0.4 * 0.38,
    )
    const near = gummyBoardStudioFloor(d.vec3f(0), 1)
    const far = gummyBoardStudioFloor(d.vec3f(40, 0, 40), 1)
    expect(near.y).toBeCloseTo(0.048)
    expect(far.y).toBeCloseTo(0.017)
  })
  it('defaults to the preserved classic board and rejects unknown runtime values', () => {
    expect(gummyBoardThemeCode()).toBe(0)
    expect(gummyBoardThemeCode('glass')).toBe(1)
    expect(gummyBoardThemeCode('lava')).toBe(2)
    expect(() => gummyBoardThemeCode('wrong' as GummyBoardTheme)).toThrow(
      'Unknown',
    )
  })
  it('keeps every playable square flat and bevels only the rim', () => {
    for (const x of [-6.4, 0, 6.4])
      for (const z of [-6.4, 0, 6.4])
        expect([
          ...gummyBoardBevelHit(d.vec3f(x, 2, z), d.vec3f(0, -1, 0)),
        ]).toEqual([0, 1, 0, 2])
    const bevel = gummyBoardBevelHit(d.vec3f(6.61, 2, 0), d.vec3f(0, -1, 0))
    expect(bevel.x).toBeCloseTo(Math.SQRT1_2)
    expect(bevel.y).toBeCloseTo(Math.SQRT1_2)
    expect(bevel.w).toBeCloseTo(2.04)
  })
  it('handles parallel misses and inside exits without infinite depth', () => {
    expect(gummyBoardBevelHit(d.vec3f(7, 2, 0), d.vec3f(0, -1, 0)).w).toBe(-1)
    expect(gummyBoardBevelHit(d.vec3f(0, 2, 0), d.vec3f(1, 0, 0)).w).toBe(-1)
    expect([
      ...gummyBoardBevelHit(d.vec3f(0, -0.1, 0), d.vec3f(0, 1, 0)),
    ]).toEqual([0, 1, 0, Math.fround(0.1)])
  })
  it('retains contrasting alternating squares for every theme without nonfinite colours', () => {
    for (const theme of [0, 1, 2]) {
      const pale = gummyBoardTileColour(d.vec2f(0.8, 0.8), theme)
      const dark = gummyBoardTileColour(d.vec2f(2.4, 0.8), theme)
      expect([...pale, ...dark].every(Number.isFinite)).toBe(true)
      expect(pale.x + pale.y + pale.z).toBeGreaterThan(
        (dark.x + dark.y + dark.z) * 1.7,
      )
    }
    expect(
      tgpu.resolve([gummyBoardBevelHit, gummyBoardStageMaterial], {
        names: 'strict',
      }),
    ).toContain('gummyBoardBevelHit')
  })
})
