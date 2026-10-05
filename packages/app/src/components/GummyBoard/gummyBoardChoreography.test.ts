/** Board population and collision/render pose agreement must survive replay and impact changes. */
import { describe, expect, it } from 'vitest'
import { createGummyBoardPieces, getGummyBoardPiecePalette, GUMMY_BOARD_ATTACKER_ID, GUMMY_BOARD_VICTIM_ID, gummyBoardCrashDuration, gummyBoardRookPose, gummyBoardRookStep, } from './gummyBoardChoreography'

describe('gummy court', () => {
  it('places all six kinds on standard opening squares, with queens on the d-file', () => {
    const pieces = createGummyBoardPieces()
    expect(pieces).toHaveLength(32)
    expect(new Set(pieces.map((p) => p.id)).size).toBe(32)
    expect(new Set(pieces.map((p) => p.position.join(','))).size).toBe(32)
    for (const side of [0, 1]) {
      for (const [mould, count] of [
        ['pawn', 8],
        ['rook', 2],
        ['knight', 2],
        ['bishop', 2],
        ['queen', 1],
        ['king', 1],
      ] as const)
        expect(
          pieces.filter((p) => p.side === side && p.mould === mould),
        ).toHaveLength(count)
    }
    expect(
      pieces.filter((p) => p.mould === 'queen').map((p) => p.square),
    ).toEqual(['d1', 'd8'])
    expect(
      pieces.filter((p) => p.mould === 'king').map((p) => p.square),
    ).toEqual(['e1', 'e8'])
    expect(pieces.find((p) => p.id === GUMMY_BOARD_VICTIM_ID)).toMatchObject({
      mould: 'pawn',
      square: 'e7',
      position: [0.8, 0, -4],
    })
    expect(pieces.find((p) => p.id === GUMMY_BOARD_ATTACKER_ID)).toMatchObject({
      mould: 'rook',
      square: 'a1',
      position: [-5.6000000000000005, 0, 5.6000000000000005],
    })
    expect(createGummyBoardPieces()).not.toBe(pieces)
  })
  it('keeps minor-piece accents and lets any explicit palette win, including the base palette', () => {
    const pieces = createGummyBoardPieces()
    expect(getGummyBoardPiecePalette(pieces[1]!, 'marble')).toBe('amber')
    expect(getGummyBoardPiecePalette(pieces[2]!, 'marble')).toBe('lagoon')
    expect(getGummyBoardPiecePalette(pieces[25]!, 'marble')).toBe('blue')
    expect(getGummyBoardPiecePalette(pieces[26]!, 'marble')).toBe('berry')
    expect(getGummyBoardPiecePalette(pieces[1]!, 'berry', { 2: 'candy' })).toBe(
      'candy',
    )
    expect(getGummyBoardPiecePalette(pieces[0]!, 'blue')).toBe('blue')
  })
})

describe('fixed rook strike', () => {
  it.each([0.5, 1, 1.5])(
    'matches the collider end pose on every tick at impact %s',
    (impact) => {
      const dt = 1 / 120
      const duration = gummyBoardCrashDuration(impact)
      for (let tick = 0; tick < Math.ceil(duration / dt); tick++) {
        const time = tick * dt
        const command = gummyBoardRookStep(time, dt, impact)
        const rendered = gummyBoardRookPose(time + dt, impact).position
        expect(Math.hypot(...command.velocity)).toBeLessThan(10)
        for (let axis = 0; axis < 3; axis++)
          expect(
            command.position[axis]! + command.velocity[axis]! * dt,
          ).toBeCloseTo(rendered[axis]!, 12)
      }
      expect(gummyBoardRookPose(duration + 1e-6, impact)).toEqual({
        position: [0, 0.24, 0],
        phase: 'complete',
      })
    },
  )
  it('clears the pawn before translating and stays centred on the captured square', () => {
    expect(gummyBoardRookPose(1.55).position).toEqual([-3.2, 3.1, 0])
    expect(gummyBoardRookPose(2.4).position).toEqual([0, 3.1, 0])
    expect(gummyBoardRookPose(3.25).position[1]).toBeCloseTo(0.3)
    expect(gummyBoardRookPose(3.6).position[0]).toBeGreaterThan(0)
    expect(gummyBoardRookPose(4.5)).toEqual({
      position: [0, 0.24, 0],
      phase: 'settling',
    })
    expect(gummyBoardRookPose(60)).toEqual({
      position: [0, 0.24, 0],
      phase: 'complete',
    })
    expect(gummyBoardRookStep(60, 1 / 120).velocity).toEqual([0, 0, 0])
    // The finishing shear stays inside the destination tile and never lifts away.
    for (let time = 3.2; time <= 6; time += 1 / 120) {
      const pose = gummyBoardRookPose(time).position
      expect(Math.abs(pose[0])).toBeLessThanOrEqual(0.18)
      expect(pose[1]).toBeLessThanOrEqual(0.3)
      expect(pose[2]).toBe(0)
    }
  })
  it('bounds invalid controls and rejects invalid steps', () => {
    expect(gummyBoardRookPose(NaN)).toEqual(gummyBoardRookPose(0))
    expect(gummyBoardCrashDuration(Infinity)).toBe(gummyBoardCrashDuration(1))
    expect(gummyBoardCrashDuration(100)).toBe(gummyBoardCrashDuration(1.5))
    expect(() => gummyBoardRookStep(0, 0)).toThrow()
  })
})
