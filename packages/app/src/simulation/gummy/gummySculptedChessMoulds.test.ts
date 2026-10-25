/** The sculpted set retains connected material, visible large details and the untouched classic comparison. */
import { describe, expect, it } from 'vitest'
import { GUMMY_CHESS_MOULDS, gummyChessField, sampleGummyChessMould, } from './gummyChessMoulds'
import { prepareGummyParticles } from './gummyParticleMath'
import type { GummyChessMould } from './gummyChessMoulds'

const moulds = Object.keys(GUMMY_CHESS_MOULDS) as GummyChessMould[]

function occupied(points: ArrayLike<number>, spacing: number) {
  const cells = new Set<string>()
  for (let i = 0; i < points.length; i += 4)
    cells.add(
      [0, 1, 2]
        .map((axis) => Math.round(points[i + axis]! / spacing - 0.5))
        .join(','),
    )
  return cells
}

function connectedCount(cells: Set<string>) {
  const first = cells.values().next().value!
  const visited = new Set([first]),
    queue = [first]
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const point = queue[cursor]!.split(',').map(Number)
    for (let axis = 0; axis < 3; axis++)
      for (const sign of [-1, 1]) {
        const next = [...point]
        next[axis]! += sign
        const key = next.join(',')
        if (cells.has(key) && !visited.has(key)) {
          visited.add(key)
          queue.push(key)
        }
      }
  }
  return visited.size
}
const field = (
  point: readonly [number, number, number],
  mould: GummyChessMould,
) => gummyChessField(point, mould, 'sculpted')

describe('sculpted gummy moulds', () => {
  for (const mould of moulds)
    for (const spacing of [0.06, 0.08, 0.1, 0.12])
      it(`${mould} remains one filled solid at ${spacing} spacing`, () => {
        const sample = prepareGummyParticles({
          fixture: mould,
          spacing,
          artStyle: 'sculpted',
        })
        const cells = occupied(sample.restPositions, spacing)
        expect(sample.restPositions.every(Number.isFinite)).toBe(true)
        expect(sample.particleCount).toBeGreaterThan(400)
        expect(connectedCount(cells)).toBe(sample.particleCount)
        expect(cells.size).toBe(sample.particleCount)
        let pinned = 0
        for (let i = 0; i < sample.restPositions.length; i += 4) {
          for (let axis = 0; axis < 3; axis++) {
            const coordinate = sample.restPositions[i + axis]!
            expect(coordinate).toBeGreaterThanOrEqual(
              GUMMY_CHESS_MOULDS[mould].bounds.min[axis]! - 1e-6,
            )
            expect(coordinate).toBeLessThanOrEqual(
              GUMMY_CHESS_MOULDS[mould].bounds.max[axis]! + 1e-6,
            )
          }
          if (sample.restPositions[i + 3] === 0) {
            expect(sample.restPositions[i + 1]).toBeLessThan(0.22)
            pinned++
          }
        }
        expect(pinned).toBeGreaterThan(0)
        expect(pinned).toBeLessThan(sample.particleCount / 3)
      })

  it.each(moulds)(
    '%s is more compact while the classic remains the default',
    (mould) => {
      const classic = sampleGummyChessMould(mould, 0.08)
      expect(sampleGummyChessMould(mould, 0.08, 0.22, 'classic')).toEqual(
        classic,
      )
      const sculpted = sampleGummyChessMould(mould, 0.08, 0.22, 'sculpted')
      expect(sculpted.length).toBeLessThan(classic.length)
      const free = prepareGummyParticles({
        fixture: mould,
        artStyle: 'sculpted',
        pinnedFeet: false,
      })
      for (let i = 0; i < free.restPositions.length; i += 4)
        expect(free.restPositions[i + 3]).toBe(1)
      expect(free.particleCount).toBe(sculpted.length / 4)
    },
  )

  it.each(moulds)(
    '%s bounds contain every occupied cell around the complete mould',
    (mould) => {
      const spacing = 0.12,
        bounds = GUMMY_CHESS_MOULDS[mould].bounds
      const cells = occupied(
        sampleGummyChessMould(mould, spacing, 0.22, 'sculpted'),
        spacing,
      )
      for (
        let x = Math.floor(bounds.min[0] / spacing) - 2;
        x < Math.ceil(bounds.max[0] / spacing) + 2;
        x++
      )
        for (let y = -2; y < Math.ceil(bounds.max[1] / spacing) + 2; y++)
          for (
            let z = Math.floor(bounds.min[2] / spacing) - 2;
            z < Math.ceil(bounds.max[2] / spacing) + 2;
            z++
          )
            if (
              field(
                [(x + 0.5) * spacing, (y + 0.5) * spacing, (z + 0.5) * spacing],
                mould,
              ) <= 0
            )
              expect(cells.has(`${x},${y},${z}`)).toBe(true)
    },
  )

  it('has two foot beads, an inset waist and a slimmer connected pawn stem', () => {
    expect(field([0.61, 0.16, 0], 'pawn')).toBeLessThan(0)
    expect(field([0.59, 0.29, 0], 'pawn')).toBeGreaterThan(0.02)
    expect(field([0.58, 0.4, 0], 'pawn')).toBeLessThan(0)
    expect(field([0.29, 1.23, 0], 'pawn')).toBeGreaterThan(0.03)
    expect(gummyChessField([0.29, 1.23, 0], 'pawn')).toBeLessThan(0)
    expect(field([0, 2.47, 0], 'pawn')).toBeGreaterThan(0.08)
    for (const side of [-1, 1])
      expect(field([side * 0.3, 2.44, 0], 'pawn')).toBeLessThan(0)
  })

  it('models horse eye sockets, nostrils, a cheek and connected mane scallops', () => {
    for (const side of [-1, 1]) {
      expect(field([0.12, 2.27, side * 0.25], 'knight')).toBeGreaterThan(0.08)
      expect(field([0.63, 2.04, side * 0.18], 'knight')).toBeGreaterThan(0.07)
      expect(field([0.02, 2.18, side * 0.19], 'knight')).toBeLessThan(0)
      expect(field([-0.18, 2.75, side * 0.19], 'knight')).toBeLessThan(0)
    }
    expect(field([-0.61, 1.12, 0], 'knight')).toBeLessThan(0)
    expect(field([-0.64, 1, 0], 'knight')).toBeGreaterThan(0)
    expect(field([0.48, 1.55, 0], 'knight')).toBeGreaterThan(0.1)
  })

  it('preserves the bishop cut, separated queen beads and the king cross corners', () => {
    expect(field([0.12, 2.37, 0], 'bishop')).toBeGreaterThan(0.08)
    expect(field([-0.16, 2.3, 0], 'bishop')).toBeLessThan(0)
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3
      expect(
        field([0.5 * Math.cos(angle), 2.73, 0.5 * Math.sin(angle)], 'queen'),
      ).toBeLessThan(0)
      expect(
        field(
          [
            0.5 * Math.cos(angle + Math.PI / 6),
            2.73,
            0.5 * Math.sin(angle + Math.PI / 6),
          ],
          'queen',
        ),
      ).toBeGreaterThan(0.1)
    }
    expect(field([0.31, 3, 0], 'king')).toBeLessThan(0)
    expect(field([0.31, 3.23, 0], 'king')).toBeGreaterThan(0.1)
  })
})
