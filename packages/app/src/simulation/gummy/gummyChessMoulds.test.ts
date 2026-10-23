/** Chess mould topology, recognisable silhouettes and base-only anchoring across particle resolutions. */
import { describe, expect, it } from 'vitest'
import { GUMMY_CHESS_MOULDS, gummyChessField, sampleGummyChessMould, } from './gummyChessMoulds'
import { prepareGummyParticles } from './gummyParticleMath'
import type { GummyChessMould } from './gummyChessMoulds'

const moulds: readonly GummyChessMould[] = [
  'pawn',
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
]
const spacings = [0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12]

function latticeCells(points: ArrayLike<number>, spacing: number) {
  const cells = new Map<string, readonly number[]>()
  for (let i = 0; i < points.length; i += 4) {
    const cell = [0, 1, 2].map((axis) =>
      Math.round(points[i + axis]! / spacing - 0.5),
    )
    cells.set(cell.join(','), cell)
  }
  return cells
}

/** Face adjacency is stricter than the MPM support radius: no corner-only ornament joins. */
function connectedCellCount(cells: ReturnType<typeof latticeCells>) {
  const first = cells.keys().next().value!
  const visited = new Set([first])
  const pending = [first]
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const cell = cells.get(pending[cursor]!)!
    for (let axis = 0; axis < 3; axis++)
      for (const direction of [-1, 1]) {
        const next = [...cell]
        next[axis]! += direction
        const key = next.join(',')
        if (!cells.has(key) || visited.has(key)) continue
        visited.add(key)
        pending.push(key)
      }
  }
  return visited.size
}

describe('gummy chess moulds', () => {
  for (const mould of moulds)
    for (const spacing of spacings)
      it(`${mould} is one filled, face-connected volume at spacing ${spacing}`, () => {
        const sample = prepareGummyParticles({ fixture: mould, spacing })
        expect(sample.particleCount).toBeGreaterThan(600)
        expect(sample.restVolume).toBeGreaterThan(1.2)
        expect(sample.restPositions.every(Number.isFinite)).toBe(true)
        const cells = latticeCells(sample.restPositions, spacing)
        expect(cells.size).toBe(sample.particleCount)
        expect(connectedCellCount(cells)).toBe(sample.particleCount)
        for (let axis = 0; axis < 3; axis++) {
          const bounds = GUMMY_CHESS_MOULDS[mould].bounds
          expect(sample.bounds.min[axis]).toBeGreaterThanOrEqual(
            bounds.min[axis]!,
          )
          expect(sample.bounds.max[axis]).toBeLessThanOrEqual(bounds.max[axis]!)
        }
        // A continuous solid core must run from the base through the stem into the head/crown.
        for (let iy = 1; (iy + 0.5) * spacing < 2.04; iy++)
          expect(cells.has(`0,${iy},0`)).toBe(true)
        // The narrowest neck still has several face-connected cells in both horizontal axes.
        for (let iy = 0; (iy + 0.5) * spacing < 1.8; iy++) {
          const slice = [...cells.values()].filter((cell) => cell[1] === iy)
          expect(slice.length).toBeGreaterThanOrEqual(12)
        }
      })

  it('has broad rounded feet, a narrower pawn neck and attached small bear ears', () => {
    expect(gummyChessField([0.7, 0.23, 0], 'pawn')).toBeLessThan(0)
    expect(gummyChessField([0.4, 1.2, 0], 'pawn')).toBeGreaterThan(0)
    expect(gummyChessField([0.36, 1.98, 0], 'pawn')).toBeLessThan(0)
    for (const side of [-1, 1])
      expect(gummyChessField([side * 0.29, 2.38, 0], 'pawn')).toBeLessThan(0)
    expect(gummyChessField([0, 2.46, 0], 'pawn')).toBeGreaterThan(0)
  })

  it('keeps two raised pawn ear lobes and a central notch at the default sample spacing', () => {
    const spacing = 0.08
    const cells = latticeCells(sampleGummyChessMould('pawn', spacing), spacing)
    // y=2.52 lies above the spherical head. Each ear survives, with empty cells between.
    for (const ix of [-5, -4, 3, 4]) expect(cells.has(`${ix},31,0`)).toBe(true)
    for (const ix of [-2, -1, 0, 1]) expect(cells.has(`${ix},31,0`)).toBe(false)
    expect(gummyChessField([0, 2.5, 0], 'pawn')).toBeGreaterThan(0.1)
    for (const side of [-1, 1])
      expect(gummyChessField([side * 0.34, 2.5, 0], 'pawn')).toBeLessThan(0)
    // The sphere narrows above its equator before the separate ear lobes flare out.
    expect(gummyChessField([0.36, 1.98, 0], 'pawn')).toBeLessThan(0)
    expect(gummyChessField([0.4, 2.23, 0], 'pawn')).toBeGreaterThan(0)
  })

  it('has four joined, rounded crenellations with open slots above a solid crown', () => {
    expect(gummyChessField([0, 2.1, 0], 'rook')).toBeLessThan(0)
    expect(gummyChessField([0, 2.42, 0], 'rook')).toBeGreaterThan(0)
    for (const side of [-1, 1]) {
      expect(gummyChessField([side * 0.48, 2.42, 0], 'rook')).toBeLessThan(0)
      expect(gummyChessField([0, 2.42, side * 0.48], 'rook')).toBeLessThan(0)
      expect(gummyChessField([side * 0.4, 2.42, 0.4], 'rook')).toBeGreaterThan(
        0,
      )
    }
  })

  it('has a horse muzzle and concave throat rather than a rotationally symmetric knight head', () => {
    expect(gummyChessField([0.55, 1.95, 0], 'knight')).toBeLessThan(0)
    expect(gummyChessField([0.48, 1.55, 0], 'knight')).toBeGreaterThan(0.1)
    expect(gummyChessField([-0.35, 1.55, 0], 'knight')).toBeLessThan(0)
    expect(gummyChessField([0, 1.95, 0.55], 'knight')).toBeGreaterThan(0.1)
    for (const side of [-1, 1])
      expect(gummyChessField([-0.2, 2.77, side * 0.2], 'knight')).toBeLessThan(
        0,
      )
    expect(gummyChessField([-0.2, 2.82, 0], 'knight')).toBeGreaterThan(0.07)
  })

  it('opens a diagonal bishop slit while leaving the lower mitre joined', () => {
    expect(gummyChessField([0.15, 2.43, 0], 'bishop')).toBeGreaterThan(0.1)
    expect(gummyChessField([-0.2, 2.33, 0], 'bishop')).toBeLessThan(0)
    expect(gummyChessField([0, 2.07, 0], 'bishop')).toBeLessThan(0)
    expect(gummyChessField([0, 2.71, 0], 'bishop')).toBeLessThan(0)
  })

  it('gives the queen six distinct coronet tips and a raised central finial', () => {
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3
      expect(
        gummyChessField(
          [0.55 * Math.cos(angle), 2.72, 0.55 * Math.sin(angle)],
          'queen',
        ),
      ).toBeLessThan(0)
      const between = angle + Math.PI / 6
      expect(
        gummyChessField(
          [0.55 * Math.cos(between), 2.72, 0.55 * Math.sin(between)],
          'queen',
        ),
      ).toBeGreaterThan(0.1)
    }
    expect(gummyChessField([0, 2.88, 0], 'queen')).toBeLessThan(0)
  })

  it('gives the king a rounded cross with open corners above a connected collar', () => {
    for (const x of [-0.34, 0, 0.34])
      expect(gummyChessField([x, 2.96, 0], 'king')).toBeLessThan(0)
    expect(gummyChessField([0, 3.28, 0], 'king')).toBeLessThan(0)
    expect(gummyChessField([0.32, 3.23, 0], 'king')).toBeGreaterThan(0.1)
    expect(gummyChessField([0, 2.65, 0], 'king')).toBeLessThan(0)
  })

  it.each(moulds)(
    '%s sampling bounds do not discard occupied lattice cells',
    (mould) => {
      const spacing = 0.12,
        bounds = GUMMY_CHESS_MOULDS[mould].bounds
      const cells = latticeCells(sampleGummyChessMould(mould, spacing), spacing)
      for (
        let y = Math.floor(bounds.min[1] / spacing) - 2;
        y <= Math.ceil(bounds.max[1] / spacing) + 1;
        y++
      )
        for (
          let x = Math.floor(bounds.min[0] / spacing) - 2;
          x <= Math.ceil(bounds.max[0] / spacing) + 1;
          x++
        )
          for (
            let z = Math.floor(bounds.min[2] / spacing) - 2;
            z <= Math.ceil(bounds.max[2] / spacing) + 1;
            z++
          ) {
            const point = [
              (x + 0.5) * spacing,
              (y + 0.5) * spacing,
              (z + 0.5) * spacing,
            ] as const
            if (gummyChessField(point, mould) <= 0)
              expect(cells.has(`${x},${y},${z}`)).toBe(true)
          }
    },
  )

  it.each(moulds)(
    'only anchors the bottom of %s without changing its rest shape or volume',
    (mould) => {
      const anchored = prepareGummyParticles({ fixture: mould, pinHeight: 0.6 })
      const free = prepareGummyParticles({ fixture: mould, pinnedFeet: false })
      expect(anchored.pinHeight).toBe(GUMMY_CHESS_MOULDS[mould].pinHeight)
      expect(free.pinHeight).toBe(0)
      expect(free.restVolume).toBe(anchored.restVolume)
      let pinned = 0
      for (let i = 0; i < anchored.restPositions.length; i += 4) {
        expect(anchored.restPositions.slice(i, i + 3)).toEqual(
          free.restPositions.slice(i, i + 3),
        )
        expect(free.restPositions[i + 3]).toBe(1)
        if (anchored.restPositions[i + 3] === 0) {
          expect(anchored.restPositions[i + 1]).toBeLessThan(0.22)
          pinned++
        } else
          expect(anchored.restPositions[i + 1]).toBeGreaterThanOrEqual(0.22)
      }
      expect(pinned).toBeGreaterThan(0)
      expect(pinned).toBeLessThan(anchored.particleCount / 3)
    },
  )

  it('rejects unbounded sampling and nonfinite fixture heights', () => {
    for (const spacing of [NaN, Infinity, 0, 0.059, 0.121])
      expect(() => sampleGummyChessMould('pawn', spacing)).toThrow(RangeError)
    for (const pinHeight of [NaN, Infinity, -1, 0.61]) {
      expect(() => sampleGummyChessMould('rook', 0.08, pinHeight)).toThrow(
        RangeError,
      )
      expect(() =>
        prepareGummyParticles({ fixture: 'rook', pinHeight }),
      ).toThrow()
    }
  })
})
