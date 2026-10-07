/** Color selection follows current geometry and the same presentation transform as rendering. */
import { describe, expect, it } from 'vitest'
import { createGummyBoardPieces } from './gummyBoardChoreography'
import { gummyBoardLocalRay, gummyBoardWorldPoint, pickGummyBoardMould, pickGummyBoardParticles, } from './gummyBoardPicking'
import { resolveGummyBoardQuality } from './gummyBoardQuality'

describe('piece selection', () => {
  it('uses the sculpted waist instead of intercepting touches with invisible classic bulk', () => {
    const rook = {
      ...createGummyBoardPieces()[0]!,
      position: [0, 0, 0] as [number, number, number],
    }
    const ray = {
      origin: [0.34, 1.05, 4] as [number, number, number],
      direction: [0, 0, -1] as [number, number, number],
    }
    expect(pickGummyBoardMould(ray, rook, 1)).toBeGreaterThan(0)
    expect(pickGummyBoardMould(ray, rook, 1, 'sculpted')).toBeUndefined()
    expect(
      pickGummyBoardMould(
        { ...ray, origin: [0.2, 1.05, 4] },
        rook,
        1,
        'sculpted',
      ),
    ).toBeGreaterThan(0)
  })
  it('transforms a scaled world ray back to the exact particle coordinates', () => {
    const point = gummyBoardWorldPoint([0.2, 1.5, -0.3], [0.8, 0, 0.8], 0.9)
    const ray = gummyBoardLocalRay(
      { origin: point, direction: [0, 0, -1] },
      [0.8, 0, 0.8],
      0.9,
    )
    expect(ray.origin[0]).toBeCloseTo(0.2)
    expect(ray.origin[1]).toBeCloseTo(1.5)
    expect(ray.origin[2]).toBeCloseTo(-0.3)
    expect(ray.direction).toEqual([0, 0, -1])
  })
  it('selects the nearest surface of every mould while leaving the spaces clear', () => {
    for (const piece of createGummyBoardPieces()) {
      const x = piece.position[0],
        z = piece.position[2]
      const ray = {
        origin: [x, 4, z] as [number, number, number],
        direction: [0, -1, 0] as [number, number, number],
      }
      const hit = pickGummyBoardMould(ray, piece, 0.9)
      expect(hit, piece.mould).toBeGreaterThan(0)
      expect(hit, piece.mould).toBeLessThan(4)
      expect(
        pickGummyBoardMould({ ...ray, origin: [x + 1, 4, z] }, piece, 0.9),
      ).toBeUndefined()
    }
  })
  it('picks displaced fragments and pinned base particles without selecting their empty rest pose', () => {
    const moved = new Float32Array([2, 1, 0, 0])
    const ray = {
      origin: [2.6, 0.9, 4] as [number, number, number],
      direction: [0, 0, -1] as [number, number, number],
    }
    expect(
      pickGummyBoardParticles(ray, moved, [0.8, 0, 0.8], 0.9, 0.08),
    ).toBeCloseTo(3.128)
    expect(
      pickGummyBoardParticles(
        { ...ray, origin: [0.8, 0.9, 4] },
        moved,
        [0.8, 0, 0.8],
        0.9,
        0.08,
      ),
    ).toBeUndefined()
  })
  it('rotates the opposite knights toward one another', () => {
    const knights = createGummyBoardPieces().filter((p) => p.mould === 'knight')
    for (const piece of knights) {
      const direction =
        piece.side === 0 ? ([0, 0, -1] as const) : ([0, 0, 1] as const)
      const local = gummyBoardLocalRay(
        { origin: piece.position, direction: [...direction] },
        piece.position,
        0.9,
        piece.rotationY,
      )
      expect(local.direction[0]).toBeCloseTo(1)
      expect(local.direction[2]).toBeCloseTo(0)
    }
  })
})

describe('board quality', () => {
  it('uses cheaper reconstruction on compact devices while allowing explicit overrides', () => {
    expect(resolveGummyBoardQuality('auto', true)).toEqual({
      name: 'tablet',
      cellSize: 0.08,
      lightResolution: 512,
    })
    expect(resolveGummyBoardQuality('auto', false)).toEqual(
      resolveGummyBoardQuality('high', true),
    )
    expect(resolveGummyBoardQuality('tablet', false)).toEqual(
      resolveGummyBoardQuality('tablet', true),
    )
  })
})
