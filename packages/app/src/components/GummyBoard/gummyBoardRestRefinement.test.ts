/** Bounded analytic refinement smooths mould surfaces without changing mesh topology or seam positions. */
import { describe, expect, it } from 'vitest'
import { GUMMY_CHESS_MOULDS, gummyChessField, } from '@/simulation/gummy/gummyChessMoulds'
import { projectGummyBoardRestPoint, refineGummyBoardRestVertices, } from './gummyBoardRestRefinement'
import type { GummyChessMould } from '@/simulation/gummy/gummyChessMoulds'

describe('sculpted board rest refinement', () => {
  it.each(Object.keys(GUMMY_CHESS_MOULDS) as GummyChessMould[])(
    'projects near-surface %s points onto the true field with bounded outward normals',
    (mould) => {
      const bounds = GUMMY_CHESS_MOULDS[mould].bounds
      let checked = 0
      for (let y = 0.06; y < bounds.max[1]; y += 0.13)
        for (let x = -0.73; x < bounds.max[0]; x += 0.13)
          for (const z of [-0.29, 0.11, 0.37]) {
            const point = [x, y, z] as const
            const before = gummyChessField(point, mould, 'sculpted')
            if (Math.abs(before) > 0.04) continue
            const projected = projectGummyBoardRestPoint(point, mould, 0.08)
            const after = gummyChessField(projected.position, mould, 'sculpted')
            expect(Math.abs(after)).toBeLessThanOrEqual(Math.abs(before) + 1e-8)
            expect(
              Math.hypot(
                ...projected.position.map((v, axis) => v - point[axis]!),
              ),
            ).toBeLessThanOrEqual(0.08000001)
            expect(Math.hypot(...projected.normal)).toBeCloseTo(1, 8)
            const outside = projected.position.map(
              (v, axis) => v + 0.002 * projected.normal[axis]!,
            ) as [number, number, number]
            expect(gummyChessField(outside, mould, 'sculpted')).toBeGreaterThan(
              after - 1e-5,
            )
            checked++
          }
      expect(checked).toBeGreaterThan(50)
    },
  )
  it('removes radial lattice ripples from the rounded pawn head', () => {
    for (let i = 0; i < 24; i++) {
      const angle = (i * Math.PI) / 12
      const radius = 0.37 + 0.025 * Math.cos(i * 1.9)
      const result = projectGummyBoardRestPoint(
        [radius * Math.cos(angle), 1.995, radius * Math.sin(angle)],
        'pawn',
        0.08,
      )
      expect(Math.hypot(result.position[0], result.position[2])).toBeCloseTo(
        0.37,
        4,
      )
      expect(result.normal[0]).toBeCloseTo(Math.cos(angle), 4)
      expect(result.normal[2]).toBeCloseTo(Math.sin(angle), 4)
    }
  })
  it('keeps duplicated edge positions identical, updates dye coordinates, and preserves packed metadata', () => {
    const vertex = {
      position: { x: 0.395, y: 1.995, z: 0, w: 1 },
      normal: { x: 0.8, y: 0.4, z: 0, w: 7 },
      rest: { x: 0.1, y: 0.2, z: 0.3, w: 3 },
    }
    const packed = refineGummyBoardRestVertices(
      [vertex, vertex, vertex],
      'pawn',
      0.08,
    )
    expect(packed.length).toBe(36)
    expect(packed.slice(0, 12)).toEqual(packed.slice(12, 24))
    expect([...packed.slice(0, 4)]).toEqual([
      Math.fround(0.37),
      Math.fround(1.995),
      0,
      1,
    ])
    expect([...packed.slice(4, 8)]).toEqual([1, 0, 0, 7])
    expect([...packed.slice(8, 12)]).toEqual([
      Math.fround(0.37),
      Math.fround(1.995),
      0,
      3,
    ])
    expect(vertex.position.x).toBe(0.395)
  })
})
