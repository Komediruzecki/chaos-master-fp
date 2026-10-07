/** Showcase captures, fixed-step poses and slow-motion clocks must remain repeatable. */
import { describe, expect, it } from 'vitest'
import { GUMMY_BUILTIN_PRESETS } from '@/pages/GummyBear/gummyBuiltinPresets'
import { GUMMY_CHESS_MOULDS } from '@/simulation/gummy/gummyChessMoulds'
import { normalizeGummyRookCollider } from '@/simulation/gummy/gummyRookCollider'
import { GUMMY_BOARD_EARLY_SHEAR_MOTION, GUMMY_BOARD_ORIGINAL_MOTION, GUMMY_BOARD_SHOT_DURATION, GUMMY_BOARD_SHOT_SIMULATION_DURATION, GUMMY_BOARD_SHOTS, gummyBoardShotPose, gummyBoardShotSimulationTime, gummyBoardShotStep, resolveGummyBoardShot, resolveGummyBoardShotMotion, } from './gummyBoardShots'

describe('gummy showcase captures', () => {
  it('retains the original compressed pause, sweep and return when motion is omitted or explicit', () => {
    const original = resolveGummyBoardShot(GUMMY_BOARD_SHOTS[0]!)
    const explicit = resolveGummyBoardShot({
      ...GUMMY_BOARD_SHOTS[0]!,
      motion: { ...GUMMY_BOARD_ORIGINAL_MOTION },
    })
    const dx = original.target[0] - original.source[0]
    const dz = original.target[2] - original.source[2]
    const length = Math.hypot(dx, dz)
    for (const [time, distance, height] of [
      [3.15, 0, 0.3],
      [3.5, 0, 0.3],
      [3.7, 0.09, 0.29],
      [3.9, 0.18, 0.28],
      [4.1, 0.09, 0.26],
      [4.3, 0, 0.24],
    ]) {
      const position = gummyBoardShotPose(original, time!, 1).position
      expect(position[0]).toBeCloseTo(
        original.target[0] + (distance! * dx) / length,
        12,
      )
      expect(position[1]).toBeCloseTo(original.target[1] + height!, 12)
      expect(position[2]).toBeCloseTo(
        original.target[2] + (distance! * dz) / length,
        12,
      )
    }
    for (let tick = 0; tick <= 720; tick++)
      expect(gummyBoardShotPose(explicit, tick / 120)).toEqual(
        gummyBoardShotPose(original, tick / 120),
      )
  })

  it('moves sideways during descent without changing the press, its final square or the material preset', () => {
    const definition = GUMMY_BOARD_SHOTS[1]!
    const original = resolveGummyBoardShot(definition)
    const early = resolveGummyBoardShot({
      ...definition,
      motion: { shearOnset: 0.35, shearDistance: 0.18, contactHold: 0 },
    })
    const scale = 0.9
    for (const [time, distance] of [
      [2.72, 0],
      [2.92, 0.09],
      [3.12, 0.18],
      [3.5, 0.18],
      [4.1, 0.09],
      [4.3, 0],
    ]) {
      const position = gummyBoardShotPose(early, time!, scale).position
      expect(
        Math.hypot(
          position[0] - early.target[0],
          position[2] - early.target[2],
        ),
      ).toBeCloseTo(distance! * scale, 12)
      expect(position[1]).toBe(
        gummyBoardShotPose(original, time!, scale).position[1],
      )
    }
    expect(gummyBoardShotPose(early, 6, scale)).toEqual(
      gummyBoardShotPose(original, 6, scale),
    )
    expect(gummyBoardShotPose(early, NaN, scale)).toEqual(
      gummyBoardShotPose(original, 0, scale),
    )
    expect(definition.motion).toBeUndefined()
    expect(early.shot.presetId).toBe('rockgummy')
  })

  it('offers press and peel as a separate motion with a mid-press sweep and the same capture square', () => {
    const definition = GUMMY_BOARD_SHOTS[0]!
    const original = resolveGummyBoardShot(definition)
    const peel = resolveGummyBoardShot({
      ...definition,
      motion: { ...GUMMY_BOARD_EARLY_SHEAR_MOTION },
    })
    const pauseStart = gummyBoardShotPose(peel, 2.725, 1).position
    const pauseEnd = gummyBoardShotPose(peel, 3.075, 1).position
    expect(pauseEnd[1]).toBeCloseTo(pauseStart[1], 12)
    expect(pauseEnd[1]).toBeGreaterThan(
      gummyBoardShotPose(original, 3.075, 1).position[1],
    )
    const swept = gummyBoardShotPose(peel, 3.12, 1).position
    expect(
      Math.hypot(swept[0] - peel.target[0], swept[2] - peel.target[2]),
    ).toBeCloseTo(1.1, 12)
    expect(gummyBoardShotPose(peel, 4.65, 1).position).toEqual(
      gummyBoardShotPose(original, 6, 1).position,
    )
    expect(definition.motion).toBeUndefined()
    expect(peel.shot.presetId).toBe(definition.presetId)
  })

  it.each([0, 0.35, 1])(
    'keeps onset %s continuous and its bounded sweep below the collider speed limit',
    (shearOnset) => {
      const shot = resolveGummyBoardShot({
        ...GUMMY_BOARD_SHOTS[1]!,
        motion: { shearOnset, shearDistance: 1.2 },
      })
      const scale = 0.85
      const dt = 1 / 120
      for (let tick = 0; tick < 720; tick++) {
        const command = gummyBoardShotStep(shot, tick * dt, dt, scale)
        const next = gummyBoardShotPose(shot, (tick + 1) * dt, scale).position
        expect(Math.hypot(...command.velocity) / scale).toBeLessThan(32)
        for (let axis = 0; axis < 3; axis++)
          expect(
            command.position[axis]! + command.velocity[axis]! * dt,
          ).toBeCloseTo(next[axis]!, 10)
      }
      const epsilon = 1e-7
      for (const boundary of [
        2.3,
        2.3 + 1.2 * shearOnset,
        2.7 + 1.2 * shearOnset,
        3.9,
        4.3,
      ]) {
        const before = gummyBoardShotStep(
          shot,
          boundary - epsilon,
          epsilon,
          scale,
        ).velocity
        const after = gummyBoardShotStep(
          shot,
          boundary,
          epsilon,
          scale,
        ).velocity
        for (let axis = 0; axis < 3; axis++)
          expect(before[axis]).toBeCloseTo(after[axis]!, 4)
      }
    },
  )

  it('allows a centered press without a sideways sweep', () => {
    const shot = resolveGummyBoardShot({
      ...GUMMY_BOARD_SHOTS[0]!,
      motion: { shearOnset: 0.35, shearDistance: 0 },
    })
    for (const time of [2.5, 2.92, 3.5, 3.9, 4.1, 6]) {
      const position = gummyBoardShotPose(shot, time).position
      expect([position[0], position[2]]).toEqual([
        shot.target[0],
        shot.target[2],
      ])
    }
  })

  it.each([0.35, 0.6])(
    'holds halfway down for %s seconds while shear continues and returns before the fixed end',
    (contactHold) => {
      const original = resolveGummyBoardShot(GUMMY_BOARD_SHOTS[0]!)
      const held = resolveGummyBoardShot({
        ...GUMMY_BOARD_SHOTS[0]!,
        motion: { shearOnset: 0.35, shearDistance: 1.2, contactHold },
      })
      const scale = 0.9
      const expectedHeight = gummyBoardShotPose(original, 2.725, scale)
        .position[1]
      for (const time of [2.725, 2.725 + contactHold / 2, 2.725 + contactHold])
        expect(gummyBoardShotPose(held, time, scale).position[1]).toBeCloseTo(
          expectedHeight,
          12,
        )
      const duringHold = gummyBoardShotStep(held, 2.8, 1 / 120, scale)
      expect(duringHold.velocity[1]).toBe(0)
      expect(
        Math.hypot(duringHold.velocity[0], duringHold.velocity[2]),
      ).toBeGreaterThan(0.1)
      const completed = gummyBoardShotPose(
        held,
        4.3 + contactHold,
        scale,
      ).position
      expect(completed[0]).toBeCloseTo(held.target[0], 12)
      expect(completed[1]).toBeCloseTo(held.target[1] + 0.24 * scale, 12)
      expect(completed[2]).toBeCloseTo(held.target[2], 12)
      expect(gummyBoardShotPose(held, 6, scale)).toEqual(
        gummyBoardShotPose(original, 6, scale),
      )
      const epsilon = 1e-7
      for (const boundary of [
        2.3,
        2.725,
        2.725 + contactHold,
        3.15 + contactHold,
        3.9 + contactHold,
        4.3 + contactHold,
        6,
      ]) {
        const before = gummyBoardShotStep(
          held,
          boundary - epsilon,
          epsilon,
          scale,
        ).velocity
        const after = gummyBoardShotStep(
          held,
          boundary,
          epsilon,
          scale,
        ).velocity
        for (let axis = 0; axis < 3; axis++)
          expect(before[axis]).toBeCloseTo(after[axis]!, 4)
      }
      for (let tick = 0; tick < 720; tick++) {
        const step = gummyBoardShotStep(held, tick / 120, 1 / 120, scale)
        expect(Math.hypot(...step.velocity) / scale).toBeLessThan(32)
      }
    },
  )

  it.each([
    null,
    [],
    {},
    { shearOnset: -0.1, shearDistance: 0.18 },
    { shearOnset: 1.1, shearDistance: 0.18 },
    { shearOnset: NaN, shearDistance: 0.18 },
    { shearOnset: 0.35, shearDistance: -0.1 },
    { shearOnset: 0.35, shearDistance: 1.21 },
    { shearOnset: 0.35, shearDistance: Infinity },
    { shearOnset: '0.35', shearDistance: 0.18 },
    { shearOnset: 0.35, shearDistance: 0.6, contactHold: -0.01 },
    { shearOnset: 0.35, shearDistance: 0.6, contactHold: 0.61 },
    { shearOnset: 0.35, shearDistance: 0.6, contactHold: null },
    { shearOnset: 0.35, shearDistance: 0.6, contactHold: Infinity },
  ])('rejects invalid shot motion %j', (motion) => {
    expect(() => resolveGummyBoardShotMotion(motion)).toThrow()
  })

  it('resolves three distinct composed positions with legal captures, kings and existing material presets', () => {
    const pairs = GUMMY_BOARD_SHOTS.map((definition) => {
      const shot = resolveGummyBoardShot(definition)
      expect(shot.pieces.filter((p) => p.mould === 'king')).toHaveLength(2)
      expect(
        GUMMY_BUILTIN_PRESETS.some((p) => p.id === definition.presetId),
      ).toBe(true)
      expect(shot.source).toEqual(shot.attacker.position)
      expect(shot.target).toEqual(shot.victim.position)
      expect(shot.source).not.toBe(shot.attacker.position)
      expect(shot.target).not.toBe(shot.victim.position)
      expect(shot.duration).toBe(8)
      expect(shot.simulationDuration).toBe(6)
      return [shot.attacker.mould, shot.victim.mould]
    })
    expect(pairs).toEqual([
      ['pawn', 'knight'],
      ['bishop', 'rook'],
      ['queen', 'rook'],
    ])
    expect(new Set(GUMMY_BOARD_SHOTS.map((s) => s.fen)).size).toBe(3)
  })

  it.each(GUMMY_BOARD_SHOTS)(
    'clears the victim then remains on the captured square in $id',
    (definition) => {
      const shot = resolveGummyBoardShot(definition)
      for (const scale of [0.85, 0.95]) {
        expect(gummyBoardShotPose(shot, 0, scale).position).toEqual(shot.source)
        const raised = gummyBoardShotPose(shot, 1.5, scale).position
        const aimed = gummyBoardShotPose(shot, 2.3, scale).position
        expect(raised[0]).toBe(shot.source[0])
        expect(raised[2]).toBe(shot.source[2])
        expect(raised[1]).toBeCloseTo(
          (GUMMY_CHESS_MOULDS[shot.victim.mould].bounds.max[1] + 0.5) * scale,
          12,
        )
        expect(aimed[0]).toBeCloseTo(shot.target[0], 12)
        expect(aimed[2]).toBeCloseTo(shot.target[2], 12)
        expect(aimed[1]).toBeCloseTo(raised[1], 12)
        expect(gummyBoardShotPose(shot, 6, scale)).toEqual({
          position: [shot.target[0], 0.24 * scale, shot.target[2]],
          phase: 'complete',
        })
        expect(gummyBoardShotPose(shot, 100, scale)).toEqual(
          gummyBoardShotPose(shot, 6, scale),
        )
        for (let tick = 0; tick < 720; tick++) {
          const time = tick / 120,
            dt = 1 / 120
          const command = gummyBoardShotStep(shot, time, dt, scale)
          const end = gummyBoardShotPose(shot, time + dt, scale).position
          for (let axis = 0; axis < 3; axis++)
            expect(
              command.position[axis]! + dt * command.velocity[axis]!,
            ).toBeCloseTo(end[axis]!, 11)
        }
      }
    },
  )

  it('maps eight display seconds to six physical seconds with smooth quarter-speed contact', () => {
    expect(gummyBoardShotSimulationTime(0)).toBe(0)
    expect(gummyBoardShotSimulationTime(2)).toBe(2)
    expect(gummyBoardShotSimulationTime(2.5)).toBe(2.3125)
    expect(gummyBoardShotSimulationTime(3.5)).toBe(2.5625)
    expect(gummyBoardShotSimulationTime(GUMMY_BOARD_SHOT_DURATION)).toBe(
      GUMMY_BOARD_SHOT_SIMULATION_DURATION,
    )
    expect(gummyBoardShotSimulationTime(20)).toBe(6)
    const dt = 1e-5
    for (const boundary of [2, 2.5, 2.5 + 13 / 6, 3 + 13 / 6]) {
      const before =
        (gummyBoardShotSimulationTime(boundary) -
          gummyBoardShotSimulationTime(boundary - dt)) /
        dt
      const after =
        (gummyBoardShotSimulationTime(boundary + dt) -
          gummyBoardShotSimulationTime(boundary)) /
        dt
      expect(before).toBeCloseTo(after, 5)
    }
    for (let i = 0; i < 960; i++) {
      const progress =
        gummyBoardShotSimulationTime((i + 1) / 120) -
        gummyBoardShotSimulationTime(i / 120)
      expect(progress).toBeGreaterThanOrEqual(0.25 / 120 - 1e-12)
      expect(progress).toBeLessThanOrEqual(1 / 120 + 1e-12)
    }
  })

  it('keeps the longest legal diagonal below the collider speed limit at every supported scale', () => {
    const shot = resolveGummyBoardShot({
      ...GUMMY_BOARD_SHOTS[0]!,
      fen: 'k6r/8/8/8/8/8/K7/B7 w - - 0 1',
      from: 'a1',
      to: 'h8',
    })
    for (const scale of [0.85, 0.9, 1]) {
      const dt = 1 / 120
      let maximum = 0
      for (let tick = 0; tick < 720; tick++) {
        const command = gummyBoardShotStep(shot, tick * dt, dt, scale)
        const velocity = command.velocity.map((value) => value / scale) as [
          number,
          number,
          number,
        ]
        expect(() =>
          normalizeGummyRookCollider({ position: command.position, velocity }),
        ).not.toThrow()
        maximum = Math.max(maximum, Math.hypot(...velocity))
        const next = gummyBoardShotPose(shot, (tick + 1) * dt, scale).position
        for (let axis = 0; axis < 3; axis++)
          expect(
            command.position[axis]! + command.velocity[axis]! * dt,
          ).toBeCloseTo(next[axis]!, 10)
      }
      expect(maximum).toBeCloseTo(
        Math.hypot(11.2, 11.2) / (0.8 * 0.85 * scale),
        9,
      )
      expect(gummyBoardShotPose(shot, 1.5, scale).position[0]).toBeCloseTo(
        shot.source[0],
        12,
      )
      expect(gummyBoardShotPose(shot, 2.3, scale).position[0]).toBeCloseTo(
        shot.target[0],
        12,
      )
    }
    const epsilon = 1e-7
    for (const boundary of [1.5, 1.5 + 0.8 * 0.15, 1.5 + 0.8 * 0.85, 2.3]) {
      const before = gummyBoardShotStep(
        shot,
        boundary - epsilon,
        epsilon,
      ).velocity
      const after = gummyBoardShotStep(shot, boundary, epsilon).velocity
      for (let axis = 0; axis < 3; axis++)
        expect(before[axis]).toBeCloseTo(after[axis]!, 4)
    }
  })

  it('keeps invalid clocks at the start and rejects invalid scale or steps', () => {
    const shot = resolveGummyBoardShot(GUMMY_BOARD_SHOTS[0]!)
    expect(gummyBoardShotSimulationTime(NaN)).toBe(0)
    expect(gummyBoardShotSimulationTime(-1)).toBe(0)
    expect(gummyBoardShotPose(shot, NaN)).toEqual(gummyBoardShotPose(shot, 0))
    expect(() => gummyBoardShotPose(shot, 0, 0)).toThrow()
    expect(() => gummyBoardShotStep(shot, 0, Infinity)).toThrow()
    expect(() => gummyBoardShotStep(shot, 0, 0)).toThrow()
  })
})
