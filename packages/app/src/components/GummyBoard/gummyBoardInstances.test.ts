/** Static instance grouping preserves optical identities while the prescribed attacker moves. */
import { describe, expect, it } from 'vitest'
import { GUMMY_BOARD_INSTANCE_FLOATS, GUMMY_BOARD_MAX_PIECES, GUMMY_BOARD_MOULDS, packGummyBoardInstance, packGummyBoardInstances, } from './gummyBoardInstances'
import type { GummyBoardPiece } from './gummyBoardInstances'

const buffer = () =>
  new Float32Array(GUMMY_BOARD_MAX_PIECES * GUMMY_BOARD_INSTANCE_FLOATS)
describe('gummy board instances', () => {
  it('packs 32 static pieces when no optical identities are reserved for simulation', () => {
    const pieces: GummyBoardPiece[] = Array.from({ length: 32 }, (_, id) => ({
      id,
      mould: 'pawn',
      position: [0, 0, 0],
      side: 0,
    }))
    expect(packGummyBoardInstances(buffer(), pieces).get('pawn')).toEqual({
      start: 0,
      count: 32,
    })
    expect(() =>
      packGummyBoardInstances(buffer(), [...pieces, { ...pieces[0]!, id: 32 }]),
    ).toThrow(/32/)
    expect(() =>
      packGummyBoardInstances(buffer(), [pieces[0]!, pieces[0]!]),
    ).toThrow(/unique/)
  })
  it('groups moulds without confusing IDs, sides or world positions', () => {
    const data = buffer()
    const pieces: GummyBoardPiece[] = [
      { id: 12, mould: 'rook', position: [-2.4, 0, 0.8], side: 1 },
      { id: 3, mould: 'pawn', position: [2.4, 0, 4], side: 0 },
      { id: 7, mould: 'rook', position: [-5.6, 0, -5.6], side: 0 },
    ]
    const ranges = packGummyBoardInstances(data, pieces, 9)
    expect(ranges.get('pawn')).toEqual({ start: 0, count: 1 })
    expect(ranges.get('rook')).toEqual({ start: 1, count: 2 })
    expect(Array.from(data.subarray(0, 4))).toEqual([Math.fround(2.4), 0, 4, 4])
    expect(Array.from(data.subarray(12, 16))).toEqual([
      Math.fround(-2.4),
      0,
      Math.fround(0.8),
      13,
    ])
    expect(data[16]).not.toBe(0)
    pieces[0] = { ...pieces[0]!, position: [0.8, 0, 0.8] }
    packGummyBoardInstances(data, pieces, 9)
    expect(data[12]).toBe(Math.fround(0.8))
    expect(data[15]).toBe(13)
  })
  it('accepts 31 instances plus one simulated piece and forbids duplicate identity', () => {
    const pieces: GummyBoardPiece[] = Array.from({ length: 31 }, (_, id) => ({
      id,
      mould: 'pawn',
      position: [0, 0, 0],
      side: 0,
    }))
    expect(packGummyBoardInstances(buffer(), pieces, 31).get('pawn')).toEqual({
      start: 0,
      count: 31,
    })
    expect(() => packGummyBoardInstances(buffer(), pieces, 0)).toThrow(/unique/)
    expect(() =>
      packGummyBoardInstances(
        buffer(),
        [...pieces, { ...pieces[0]!, id: 31 }],
        32,
      ),
    ).toThrow(/31/)
  })
  it('keeps half-float tags exact and rejects malformed uploads', () => {
    const data = buffer()
    packGummyBoardInstance(data, 0, 2047, [0, 0, 0], 0)
    expect(data[3]).toBe(2048)
    for (const id of [-1, 0.5, NaN, 2048])
      expect(() => {
        packGummyBoardInstance(data, 0, id, [0, 0, 0], 0)
      }).toThrow(/identity/)
    expect(() => {
      packGummyBoardInstance(data, 0, 1, [NaN, 0, 0], 0)
    }).toThrow(/finite/)
    expect(() => {
      packGummyBoardInstance(data, 32, 1, [0, 0, 0], 0)
    }).toThrow(/small/)
  })

  it('reserves two unique optical identities and limits waiting instances in pair mode', () => {
    const pieces: GummyBoardPiece[] = Array.from({ length: 30 }, (_, id) => ({
      id,
      mould: 'pawn',
      position: [0, 0, 0],
      side: 0,
    }))
    expect(
      packGummyBoardInstances(buffer(), pieces, 30, 31).get('pawn'),
    ).toEqual({ start: 0, count: 30 })
    expect(() =>
      packGummyBoardInstances(
        buffer(),
        [...pieces, { ...pieces[0]!, id: 32 }],
        30,
        31,
      ),
    ).toThrow(/30/)
    expect(() => packGummyBoardInstances(buffer(), pieces, 30, 30)).toThrow(
      /unique/,
    )
    expect(() => packGummyBoardInstances(buffer(), pieces, 30, 0)).toThrow(
      /unique/,
    )
  })
  it('packs all six moulds with independent dye, scale and orientation', () => {
    const pieces: GummyBoardPiece[] = [...GUMMY_BOARD_MOULDS]
      .reverse()
      .map((mould, id) => ({
        id,
        mould,
        position: [id, 0, 0],
        side: 1,
        scale: 0.9,
        palette: 'berry',
        rotationY: Math.PI / 2,
      }))
    const data = buffer()
    const ranges = packGummyBoardInstances(data, pieces, 31)
    expect(ranges.size).toBe(6)
    GUMMY_BOARD_MOULDS.forEach((mould, index) => {
      expect(ranges.get(mould)).toEqual({ start: index, count: 1 })
      const offset = index * GUMMY_BOARD_INSTANCE_FLOATS
      expect(data[offset + 3]).toBe(
        pieces.find((piece) => piece.mould === mould)!.id + 1,
      )
      expect(data[offset + 7]).toBe(Math.fround(0.9))
      expect(data[offset + 8]).toBe(3)
      expect(data[offset + 10]).toBe(1)
      expect(data[offset + 11]).toBeCloseTo(0)
    })
    packGummyBoardInstance(data, 0, 2, [0, 0, 0], 0)
    expect(Array.from(data.subarray(7, 12))).toEqual([1, 0, 0, 0, 1])
    for (const scale of [0, -1, Infinity, NaN, 4.1])
      expect(() => {
        packGummyBoardInstance(data, 0, 2, [0, 0, 0], 0, scale)
      }).toThrow(/scale/)
  })
})
