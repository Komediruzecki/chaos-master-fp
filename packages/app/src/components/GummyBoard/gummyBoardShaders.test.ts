/** Board shader resolution and optical identity/checker alignment regressions. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { marchingGummyComposite, marchingGummyMaterialSlot, } from '../GummyBear/marchingGummyRenderShaders'
import { gummyBoardBackgroundFragment, gummyBoardExitFragment, gummyBoardFrontFragment, gummyBoardLightFragment, gummyBoardLightVertex, gummyBoardMatchingExit, gummyBoardMaterialAt, gummyBoardOptics, gummyBoardShadowFragment, gummyBoardShadowVertex, gummyBoardSquareColour, gummyBoardVertex, gummyBoardWorldPosition, } from './gummyBoardShaders'

describe('gummy board optical passes', () => {
  it.each([
    gummyBoardVertex,
    gummyBoardFrontFragment,
    gummyBoardExitFragment,
    gummyBoardLightVertex,
    gummyBoardLightFragment,
    gummyBoardShadowFragment,
    gummyBoardShadowVertex,
    gummyBoardBackgroundFragment,
  ])('resolves an instanced GPU entrypoint and its dependencies', (shader) => {
    const source = tgpu.resolve([shader], { names: 'strict' })
    expect(source).toMatch(/@(vertex|fragment)/)
    expect(source).not.toContain('NaN')
  })
  it('rejects another piece’s rear surface even when its depth is closer', () => {
    expect(gummyBoardMatchingExit(4, 4, 8, 8.5)).toBe(true)
    expect(gummyBoardMatchingExit(4, 5, 8, 8.2)).toBe(false)
    expect(gummyBoardMatchingExit(4, 4, 8, 7.8)).toBe(false)
    expect(gummyBoardMatchingExit(0, 0, 0, 3)).toBe(false)
    expect(gummyBoardMatchingExit(2048, 2048, 8, 8.5)).toBe(true)
  })
  it('keeps each board square centre and its corners the same colour', () => {
    for (let x = 0; x < 8; x++)
      for (let z = 0; z < 8; z++) {
        const cx = (x - 3.5) * 1.6
        const cz = (z - 3.5) * 1.6
        const centre = [...gummyBoardSquareColour(d.vec2f(cx, cz))]
        for (const dx of [-0.79, 0.79])
          for (const dz of [-0.79, 0.79])
            expect([
              ...gummyBoardSquareColour(d.vec2f(cx + dx, cz + dz)),
            ]).toEqual(centre)
        expect([...gummyBoardSquareColour(d.vec2f(cx + 1.6, cz))]).not.toEqual(
          centre,
        )
      }
  })
  it('resolves the shared optical composite with per-piece material selection', () => {
    const source = tgpu.resolve(
      [
        tgpu
          .lazy(() => marchingGummyComposite)
          .with(marchingGummyMaterialSlot, gummyBoardOptics),
      ],
      { names: 'strict' },
    )
    expect(source).toContain('gummyBoardMaterialAt')
    expect(source).toContain('gummyVolumeTransmission')
  })
  it('transforms the full silhouette including facing and preserves selected palette coefficients', () => {
    expect([
      ...gummyBoardWorldPosition(
        d.vec3f(1, 2, 0),
        d.vec4f(3, 0, 4, 1),
        0.9,
        d.vec2f(1, 0),
      ),
    ]).toEqual([3, Math.fround(1.8), Math.fround(3.1)])
    const inherited = d.vec4f(9, 8, 7, 0.06)
    const colour = d.vec4f(0.1, 0.2, 0.3, 2)
    expect([...gummyBoardMaterialAt(0, inherited, colour).absorption]).toEqual([
      ...inherited,
    ])
    expect([...gummyBoardMaterialAt(2, inherited, colour).absorption]).toEqual(
      [0.12, 0.8, 3.5, 0.06].map(Math.fround),
    )
    expect(gummyBoardMaterialAt(6, inherited, colour).colour.w).toBe(3)
  })
  it('uses whole-triangle world-space validity for board shadows', () => {
    const source = tgpu.resolve([gummyBoardShadowVertex], { names: 'strict' })
    expect(source).toContain('marchingGummyShadowTriangleProjection')
    expect(source).toContain('gummyBoardWorldPosition')
  })
})
