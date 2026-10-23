/** A collection shares role geometry across a legal starting layout while tint stays per instance. */
import { describe, expect, it } from 'vitest'
import { collectionInstances } from './collectionStageLayout'

describe('collectionInstances', () => {
  it('places the complete thirty-two-piece set without overlapping squares', () => {
    const pieces = collectionInstances('board', 'pawn', 'light', false)
    expect(pieces).toHaveLength(32)
    expect(
      new Set(
        pieces.map((piece) => `${piece.square!.file}:${piece.square!.rank}`),
      ).size,
    ).toBe(32)
    for (const side of ['light', 'dark']) {
      const army = pieces.filter((piece) => piece.side === side)
      expect(
        Object.fromEntries(
          ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'].map((role) => [
            role,
            army.filter((piece) => piece.role === role).length,
          ]),
        ),
      ).toEqual({ pawn: 8, rook: 2, knight: 2, bishop: 2, queen: 1, king: 1 })
      expect(army.find((piece) => piece.role === 'queen')!.square!.file).toBe(3)
      expect(army.find((piece) => piece.role === 'king')!.square!.file).toBe(4)
    }
    expect(new Set(pieces.map((piece) => piece.cloudKey)).size).toBe(12)
    expect(pieces.every((piece) => piece.scale === 0.9)).toBe(true)
  })

  it('keeps all matching pieces on the same cloud when colour variation is enabled', () => {
    const plain = collectionInstances('board', 'bishop', 'dark', false)
    const varied = collectionInstances('board', 'bishop', 'dark', true)
    expect(varied.map((piece) => piece.cloudKey)).toEqual(
      plain.map((piece) => piece.cloudKey),
    )
    expect(varied.map((piece) => piece.position)).toEqual(
      plain.map((piece) => piece.position),
    )
    expect(plain[0]!.colorMultiplier).toEqual([1, 1, 1])
    expect(varied[0]!.colorMultiplier).toEqual([0.95, 1, 1.05])
    expect(varied.filter((piece) => piece.selected)).toHaveLength(2)
  })

  it('shows one of every role or just the selected role for close inspection', () => {
    const lineup = collectionInstances('lineup', 'rook', 'dark', false)
    expect(lineup.map((piece) => piece.role)).toEqual([
      'pawn',
      'rook',
      'knight',
      'bishop',
      'queen',
      'king',
    ])
    expect(lineup.every((piece) => piece.side === 'dark')).toBe(true)
    expect(lineup.map((piece) => piece.position[0])).toEqual([
      -4.625, -2.7750000000000004, -0.925, 0.925, 2.7750000000000004, 4.625,
    ])
    const solo = collectionInstances('solo', 'knight', 'light', false)
    expect(solo).toHaveLength(1)
    expect(solo[0]!.cloudKey).toBe('knight:light')
    expect(solo[0]!.position).toEqual([0, 0.09, 0])
  })
})
