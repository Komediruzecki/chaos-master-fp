/** The same 64 contact-plane squares drive CPU pieces, GPU insets and orbiting pointer targets. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { GUMMY_BOARD_GRID, GUMMY_BOARD_SLAB, gummyBoardGridCentre, gummyBoardGridSquare, } from './gummyBoardGrid'
import { gummyBoardGlassInset, gummyBoardGlassTransmission, gummyBoardGridCell, gummyBoardGridContains, gummyBoardSquareParity, } from './gummyBoardGridShaders'
import { gummyBoardSquare } from './gummyBoardPosition'
import { gummyBoardBevelHit } from './gummyBoardStageShaders'
import { GUMMY_BOARD_GLASS_FLOOR } from './gummyBoardThemes'
import { gummyMatchFloorSquare, gummyMatchSquareMarker, } from './gummyMatchPresentation'
import type { GummyVec3 } from '../GummyBear/gummyStudyMath'

describe('gummy board contact grid', () => {
  it('maps all 64 square centres and inset interiors to the same CPU and shader cells', () => {
    const squares = new Set<string>()
    for (let file = 0; file < 8; file++)
      for (let rank = 0; rank < 8; rank++) {
        const square = `${'abcdefgh'[file]}${rank + 1}`
        const centre = gummyBoardGridCentre(file, rank)
        expect(gummyBoardSquare(square).position).toEqual(centre)
        expect(centre[1]).toBe(0)
        for (const dx of [-0.74, 0, 0.74])
          for (const dz of [-0.74, 0, 0.74]) {
            const point = d.vec2f(centre[0] + dx, centre[2] + dz)
            expect([...gummyBoardGridCell(point)]).toEqual([file, rank])
            expect(gummyBoardGridContains(point)).toBe(true)
            expect(gummyBoardGridSquare(point.x, point.y)).toBe(square)
            expect(gummyBoardSquareParity(point)).toBe((file + rank + 1) % 2)
            expect(gummyBoardGlassInset(point).frost).toBeGreaterThan(0)
          }
        squares.add(square)
      }
    expect(squares.size).toBe(64)
  })

  it('keeps all four corners and move markers on the physical top from overhead and grazing rays', () => {
    const projection = new Float32Array([
      0.1, 0, 0, 0, 0, 0.2, 0, 0, 0, 0.1, 0, 0, 0, 0, 0, 1,
    ])
    for (const square of ['a1', 'a8', 'h1', 'h8']) {
      const point = gummyBoardSquare(square).position
      for (const offset of [
        [0, 8, 0],
        [8, 2, 3],
        [-7, 0.15, 5],
      ]) {
        const length = Math.hypot(...offset)
        const origin = point.map((v, index) => v + offset[index]!) as GummyVec3
        const direction = offset.map((v) => -v / length) as GummyVec3
        expect(gummyMatchFloorSquare({ origin, direction })).toBe(square)
        const hit = gummyBoardBevelHit(
          d.vec3f(...origin),
          d.vec3f(...direction),
        )
        expect(hit.y).toBe(1)
        expect(hit.w).toBeCloseTo(length, 4)
      }
      const marker = gummyMatchSquareMarker(square, projection)!
      expect(marker.x).toBeCloseTo((1 + point[0] * 0.1) * 50)
      expect(marker.y).toBeCloseTo((1 - point[2] * 0.1) * 50)
    }
  })

  it('rejects the slab rim and the lower receiver as playable squares', () => {
    for (const [x, z] of [
      [6.5, 0],
      [-6.5, 0],
      [0, 6.5],
      [0, -6.5],
    ]) {
      expect(gummyBoardGridSquare(x!, z!)).toBeUndefined()
      expect(gummyBoardGridContains(d.vec2f(x!, z!))).toBe(false)
      expect(gummyBoardGlassInset(d.vec2f(x!, z!)).frost).toBe(0)
    }
    expect(gummyBoardGridSquare(NaN, 0)).toBeUndefined()
    expect(
      gummyMatchFloorSquare({ origin: [0, -0.5, 0], direction: [0, -1, 0] }),
    ).toBeUndefined()
    expect(GUMMY_BOARD_GRID.halfExtent).toBeLessThan(
      GUMMY_BOARD_SLAB.halfExtent - GUMMY_BOARD_SLAB.bevel,
    )
    expect(GUMMY_BOARD_GLASS_FLOOR).toBeLessThan(GUMMY_BOARD_SLAB.bottom)
  })

  it('places contrast and etched seams on the insets while the substrate stays transmissive', () => {
    const darkPoint = gummyBoardGridCentre(0, 0)
    const palePoint = gummyBoardGridCentre(1, 0)
    const dark = gummyBoardGlassInset(d.vec2f(darkPoint[0], darkPoint[2]))
    const pale = gummyBoardGlassInset(d.vec2f(palePoint[0], palePoint[2]))
    expect(pale.colour.x + pale.colour.y + pale.colour.z).toBeGreaterThan(
      3 * (dark.colour.x + dark.colour.y + dark.colour.z),
    )
    expect(dark.seam).toBe(0)
    expect(pale.seam).toBe(0)
    expect(gummyBoardGlassInset(d.vec2f(-4.8, darkPoint[2])).seam).toBeCloseTo(
      1,
    )
    const light = [darkPoint, palePoint].map((point) =>
      gummyBoardGlassTransmission(d.vec3f(...point), d.vec3f(0, 1, 0), 0.32),
    )
    for (const transmission of light)
      expect(
        [...transmission].every((value) => value > 0.7 && value <= 1),
      ).toBe(true)
    // Strong checker contrast belongs to the surface; softly tinted transmitted
    // light must not create the displaced second playing grid below it.
    expect(light[1]!.x / light[0]!.x).toBeLessThan(1.25)
    expect(
      tgpu.resolve([gummyBoardGlassInset], { names: 'strict' }),
    ).not.toContain('NaN')
  })
})
