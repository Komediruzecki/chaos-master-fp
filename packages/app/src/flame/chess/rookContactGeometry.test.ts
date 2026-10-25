/** Cell-union collision metadata must preserve material volume and avoid false inter-fragment overlaps. */
import { describe, expect, it } from 'vitest'
import { sampleFlameFigurineCloud } from './flameFigurineCloud'
import { buildFractalChessFlame } from './fractalChessCollections'
import { buildWindowRookFracture } from './windowRookFracture'

describe('connected rook collision geometry', () => {
  it('covers the material exactly once, shares real face bonds and stays within its box budget', () => {
    const cloud = sampleFlameFigurineCloud(
      buildFractalChessFlame('lattice-court', 'rook', 'light'),
      { count: 24_000, seed: 42, lightness: 0.64 },
    )
    const solid = buildWindowRookFracture(
        'rook:light',
        cloud.points,
        cloud.colors,
      ),
      { physics } = solid
    const boxes: { center: number[]; half: number[] }[] = []
    let volume = 0
    for (const chunk of physics.chunks) {
      let chunkVolume = 0
      for (let offset = 0; offset < chunk.boxes.length; offset += 6) {
        const half = Array.from(chunk.boxes.subarray(offset + 3, offset + 6))
        chunkVolume += 8 * half[0]! * half[1]! * half[2]!
        boxes.push({
          center: Array.from(
            chunk.boxes.subarray(offset, offset + 3),
            (n, axis) => n + chunk.centroid[axis]!,
          ),
          half,
        })
      }
      volume += chunkVolume
      expect(chunkVolume).toBeCloseTo(chunk.mass, 7)
      expect(chunk.supportPoints.every(Number.isFinite)).toBe(true)
    }
    expect(boxes.length).toBeLessThanOrEqual(1500)
    expect(volume).toBeCloseTo(solid.diagnostics.volume, 6)
    const sharedArea = physics.bonds.reduce((sum, bond) => sum + bond.area, 0)
    expect(sharedArea * 2).toBeCloseTo(
      solid.diagnostics.interfaceFaces * physics.cellSize ** 2,
      7,
    )
    let overlap = false
    for (let a = 0; a < boxes.length; a++)
      for (let b = 0; b < a; b++)
        overlap ||= [0, 1, 2].every(
          (axis) =>
            Math.abs(boxes[a]!.center[axis]! - boxes[b]!.center[axis]!) <
            boxes[a]!.half[axis]! + boxes[b]!.half[axis]! - 1e-6,
        )
    expect(overlap).toBe(false)
  })
})
