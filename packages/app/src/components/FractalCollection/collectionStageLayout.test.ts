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

  it.each(['rook', 'knight', 'bishop'] as const)(
    'keeps a same-colour pure/glass %s pair on each side of the complete board',
    (role) => {
      const pieces = collectionInstances('board', role, 'light', true, {
        role,
        key: 'study',
        enclosure: 'both',
      })
      expect(pieces).toHaveLength(32)
      for (const side of ['light', 'dark'] as const) {
        const pair = pieces.filter(
          (piece) => piece.role === role && piece.side === side,
        )
        expect(pair).toHaveLength(2)
        expect(pair[0]!.glassKey).toBeUndefined()
        expect(pair[1]!.glassKey).toBe('study')
        expect(pair[0]!.cloudKey).toBe(pair[1]!.cloudKey)
        expect(pair[0]!.colorMultiplier).toEqual(pair[1]!.colorMultiplier)
        expect(pair[0]!.square!.file).toBeLessThan(4)
        expect(pair[1]!.square!.file).toBeGreaterThanOrEqual(4)
      }
      expect(pieces.filter((piece) => piece.glassKey)).toHaveLength(2)
    },
  )

  it('encloses only the supported role and restores the exact pure layout', () => {
    const baseline = collectionInstances('board', 'rook', 'dark', true)
    const pure = collectionInstances('board', 'rook', 'dark', true, {
      role: 'rook',
      key: 'study',
      enclosure: 'pure',
    })
    expect(pure).toEqual(baseline)
    const glass = collectionInstances('board', 'rook', 'dark', true, {
      role: 'rook',
      key: 'study',
      enclosure: 'glass',
    })
    expect(
      glass.filter((piece) => piece.glassKey).map((piece) => piece.role),
    ).toEqual(['rook', 'rook', 'rook', 'rook'])
    expect(glass.map((piece) => piece.colorMultiplier)).toEqual(
      baseline.map((piece) => piece.colorMultiplier),
    )
    expect(glass.map((piece) => piece.position)).toEqual(
      baseline.map((piece) => piece.position),
    )
  })

  it('pairs the supported solo specimen and inserts a matching adjacent lineup copy', () => {
    const settings = { role: 'knight', key: 'fern', enclosure: 'both' } as const
    const solo = collectionInstances('solo', 'knight', 'dark', true, settings)
    expect(solo.map((piece) => piece.position)).toEqual([
      [-0.85, 0.09, 0],
      [0.85, 0.09, 0],
    ])
    expect(solo.map((piece) => piece.glassKey)).toEqual([undefined, 'fern'])
    expect(solo[0]!.colorMultiplier).toEqual(solo[1]!.colorMultiplier)
    const lineup = collectionInstances(
      'lineup',
      'knight',
      'dark',
      true,
      settings,
    )
    expect(lineup.map((piece) => piece.role)).toEqual([
      'pawn',
      'rook',
      'knight',
      'knight',
      'bishop',
      'queen',
      'king',
    ])
    expect(lineup.map((piece) => piece.glassKey)).toEqual([
      undefined,
      undefined,
      undefined,
      'fern',
      undefined,
      undefined,
      undefined,
    ])
    expect(lineup[2]!.colorMultiplier).toEqual(lineup[3]!.colorMultiplier)
    expect(
      collectionInstances('solo', 'pawn', 'light', false, settings),
    ).toHaveLength(1)
  })
})
