/** Capture variety remains reproducible, bounded around neighbours and shared by render and contact. */
import { describe, expect, it } from 'vitest'
import { GUMMY_CHESS_MOULDS } from '@/simulation/gummy/gummyChessMoulds'
import { GUMMY_BOARD_GRID } from './gummyBoardGrid'
import { GUMMY_BOARD_SHOTS, gummyBoardShotPose, gummyBoardShotRotation, gummyBoardShotStep, resolveGummyBoardShot, resolveGummyBoardShotMotion, } from './gummyBoardShots'
import { chooseGummyCaptureMechanic, createGummyCaptureMechanic, GUMMY_CAPTURE_MECHANICS, gummyCaptureMechanicContext, parseGummyCaptureMechanic, } from './gummyCaptureMechanics'
import type { GummyCaptureMechanicId } from './gummyCaptureMechanics'

describe('physical capture mechanics', () => {
  it('includes the original press in every seeded three-choice round without repeating at the boundary', () => {
    for (const seed of [0, 1, 2, 21, 0xffffffff]) {
      const history: GummyCaptureMechanicId[] = []
      for (let index = 0; index < 30; index++) {
        const choice = chooseGummyCaptureMechanic(seed, history)
        expect(choice).toEqual(chooseGummyCaptureMechanic(seed, [...history]))
        expect(choice.mechanic.id).not.toBe(history.at(-1))
        history.push(choice.mechanic.id)
        if (history.length % 3 === 0) {
          const round = history.slice(-3)
          expect(new Set(round).size).toBe(3)
          expect(round).toContain('press-settle')
        }
      }
    }
  })

  it('counts repeated safe presses once and resumes the unfinished round when space becomes available', () => {
    const history: GummyCaptureMechanicId[] = []
    for (let index = 0; index < 4; index++)
      history.push(
        chooseGummyCaptureMechanic(index, history, {
          maxShearDistance: 0,
          maxTwistAngle: 0,
        }).mechanic.id,
      )
    expect(history).toEqual(Array(4).fill('press-settle'))
    for (let index = 0; index < 2; index++)
      history.push(chooseGummyCaptureMechanic(index, history).mechanic.id)
    expect(new Set(history.slice(-3)).size).toBe(3)
    const choice = chooseGummyCaptureMechanic(5, history)
    expect(choice.mechanic.id).not.toBe(history.at(-1))
  })

  it('limits a corner capture against the board edge even with no nearby pieces', () => {
    const base = {
      ...GUMMY_BOARD_SHOTS[0]!,
      fen: 'k6r/6B1/8/8/8/8/8/K7 w - - 0 1',
      from: 'g7',
      to: 'h8',
    }
    const scale = 0.9
    const context = gummyCaptureMechanicContext(base, scale)
    expect(context.maxShearDistance).toBeGreaterThan(0)
    expect(context.maxShearDistance).toBeLessThan(0.03)
    const radius = GUMMY_CHESS_MOULDS.bishop.bounds.max[0]
    for (const { id } of GUMMY_CAPTURE_MECHANICS) {
      for (const seed of [1, 2]) {
        const shot = resolveGummyBoardShot({
          ...base,
          ...createGummyCaptureMechanic(id, seed, context),
        })
        for (let tick = 276; tick <= 720; tick += 3) {
          const time = tick / 120
          const pose = gummyBoardShotPose(shot, time, scale)
          const angle = gummyBoardShotRotation(shot, time)
          const halfExtent =
            radius *
            (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle))) *
            scale
          for (const axis of [0, 2])
            expect(
              Math.abs(pose.position[axis]!) + halfExtent,
            ).toBeLessThanOrEqual(GUMMY_BOARD_GRID.halfExtent - 0.011999)
        }
      }
    }
  })

  it('repeats the same selection and resolved motion without repeating the previous choice', () => {
    const selected = new Set<string>()
    for (let seed = 0; seed < 100; seed++) {
      const choice = chooseGummyCaptureMechanic(seed)
      expect(chooseGummyCaptureMechanic(seed)).toEqual(choice)
      expect(
        chooseGummyCaptureMechanic(seed, choice.mechanic.id).mechanic.id,
      ).not.toBe(choice.mechanic.id)
      selected.add(choice.mechanic.id)
    }
    expect(selected.size).toBe(3)
    const blocked = chooseGummyCaptureMechanic(100, 'press-settle', {
      maxShearDistance: 0,
      maxTwistAngle: 0,
    })
    expect(blocked.mechanic.id).toBe('press-settle')
    expect(blocked.motion.shearDistance).toBe(0)
  })

  it('rejects invalid provenance and physical values while preserving legacy motion objects', () => {
    for (const seed of [-1, 0.5, Infinity, NaN, 0x100000000])
      expect(() => chooseGummyCaptureMechanic(seed)).toThrow('seed')
    for (const value of [
      null,
      [],
      { version: 2, id: 'press-settle', seed: 0 },
      { version: 1, id: 'unknown', seed: 0 },
    ])
      expect(() => parseGummyCaptureMechanic(value)).toThrow()
    expect(
      parseGummyCaptureMechanic({
        version: 1,
        id: 'rock-shear',
        seed: 0xffffffff,
      }),
    ).toEqual({ version: 1, id: 'rock-shear', seed: 0xffffffff })
    const original = { shearOnset: 1, shearDistance: 0.18, contactHold: 0 }
    expect(resolveGummyBoardShotMotion(original)).toEqual(original)
    for (const extra of [
      { shearSign: 0 },
      { shearSign: 2 },
      { twistAngle: NaN },
      { twistAngle: -0.1 },
      { twistAngle: 0.36 },
    ])
      expect(() =>
        resolveGummyBoardShotMotion({ ...original, ...extra }),
      ).toThrow()
    expect(() =>
      createGummyCaptureMechanic('rock-shear', 0, { maxTwistAngle: NaN }),
    ).toThrow()
    expect(() =>
      gummyCaptureMechanicContext(GUMMY_BOARD_SHOTS[0]!, 0),
    ).toThrow()
  })

  it('retains exact original press poses and restores every mechanic to the captured square and heading', () => {
    const base = GUMMY_BOARD_SHOTS[0]!
    const legacy = resolveGummyBoardShot(base)
    const press = resolveGummyBoardShot({
      ...base,
      ...createGummyCaptureMechanic('press-settle', 3),
    })
    for (let tick = 0; tick <= 720; tick++) {
      expect(gummyBoardShotPose(press, tick / 120)).toEqual(
        gummyBoardShotPose(legacy, tick / 120),
      )
      expect(gummyBoardShotRotation(press, tick / 120)).toBe(0)
    }
    for (const { id } of GUMMY_CAPTURE_MECHANICS) {
      const shot = resolveGummyBoardShot({
        ...base,
        ...createGummyCaptureMechanic(id, 123),
      })
      for (const time of [6, 8, 100]) {
        expect(gummyBoardShotPose(shot, time)).toEqual(
          gummyBoardShotPose(legacy, time),
        )
        expect(gummyBoardShotRotation(shot, time)).toBe(0)
      }
    }
  })

  it('drives actual alternating yaw and matches both rendered coordinates at the end of each fixed tick', () => {
    const shot = resolveGummyBoardShot({
      ...GUMMY_BOARD_SHOTS[0]!,
      ...createGummyCaptureMechanic('rock-shear', 2),
    })
    let positive = false,
      negative = false
    const dt = 1 / 120,
      scale = 0.9
    for (let tick = 0; tick < 720; tick++) {
      const time = tick * dt,
        step = gummyBoardShotStep(shot, time, dt, scale)
      const end = gummyBoardShotPose(shot, time + dt, scale)
      for (let axis = 0; axis < 3; axis++)
        expect(step.position[axis]! + step.velocity[axis]! * dt).toBeCloseTo(
          end.position[axis]!,
          10,
        )
      expect(step.rotationY + step.angularVelocityY * dt).toBeCloseTo(
        gummyBoardShotRotation(shot, time + dt),
        10,
      )
      expect(Math.abs(step.angularVelocityY)).toBeLessThan(4)
      expect(Math.hypot(...step.velocity) / scale).toBeLessThan(32)
      positive ||= step.rotationY > 0.03
      negative ||= step.rotationY < -0.03
    }
    expect(positive && negative).toBe(true)
    for (const knot of [2.3, 2.9, 3.6, 4.1, 4.5])
      expect(
        Math.abs(
          gummyBoardShotStep(shot, knot - 0.000001, 0.000002).angularVelocityY,
        ),
      ).toBeLessThan(0.0001)
  })

  it('keeps the full rotated footprint clear of each neighbouring piece throughout contact', () => {
    const half = (mould: keyof typeof GUMMY_CHESS_MOULDS, angle: number) => {
      const { min, max } = GUMMY_CHESS_MOULDS[mould].bounds
      const x = Math.max(Math.abs(min[0]), Math.abs(max[0])),
        z = Math.max(Math.abs(min[2]), Math.abs(max[2]))
      return [
        x * Math.abs(Math.cos(angle)) + z * Math.abs(Math.sin(angle)),
        z * Math.abs(Math.cos(angle)) + x * Math.abs(Math.sin(angle)),
      ]
    }
    for (const base of GUMMY_BOARD_SHOTS)
      for (const scale of [0.85, 0.9, 0.95])
        for (const { id } of GUMMY_CAPTURE_MECHANICS)
          for (const seed of [1, 2]) {
            const choice = createGummyCaptureMechanic(
              id,
              seed,
              gummyCaptureMechanicContext(base, scale),
            )
            const shot = resolveGummyBoardShot({ ...base, ...choice })
            for (let tick = 276; tick <= 720; tick += 3) {
              const time = tick / 120,
                pose = gummyBoardShotPose(shot, time, scale)
              const moving = half(
                shot.attacker.mould,
                (shot.attacker.rotationY ?? 0) +
                  gummyBoardShotRotation(shot, time),
              )
              expect(
                Math.abs(pose.position[0]) + moving[0]! * scale,
              ).toBeLessThanOrEqual(GUMMY_BOARD_GRID.halfExtent - 0.011999)
              expect(
                Math.abs(pose.position[2]) + moving[1]! * scale,
              ).toBeLessThanOrEqual(GUMMY_BOARD_GRID.halfExtent - 0.011999)
              for (const piece of shot.pieces) {
                if (
                  piece.id === shot.attacker.id ||
                  piece.id === shot.victim.id
                )
                  continue
                const fixed = half(piece.mould, piece.rotationY ?? 0)
                const gapX =
                  Math.abs(pose.position[0] - piece.position[0]) -
                  (moving[0]! + fixed[0]!) * scale
                const gapZ =
                  Math.abs(pose.position[2] - piece.position[2]) -
                  (moving[1]! + fixed[1]!) * scale
                expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(0.011999)
              }
            }
          }
  })
})
