/** Project each shot's padded actor bounds through the actual portrait and landscape camera paths. */
import { describe, expect, it } from 'vitest'
import { gummyBoardShotCamera } from './gummyBoardShotCamera'
import { GUMMY_BOARD_SHOTS, resolveGummyBoardShot } from './gummyBoardShots'

describe('gummy cinema camera', () => {
  it.each(GUMMY_BOARD_SHOTS)(
    'keeps the actors inside every frame of $id',
    (definition) => {
      const shot = resolveGummyBoardShot(definition)
      for (const aspect of [9 / 16, 1, 16 / 9])
        for (const scale of [0.85, 0.95])
          for (let time = 0; time <= 8; time += 0.25) {
            const camera = gummyBoardShotCamera(shot, time, aspect, scale)
            const m = camera.viewProjection,
              { min, max } = camera.bounds
            for (const x of [min[0], max[0]])
              for (const y of [min[1], max[1]])
                for (const z of [min[2], max[2]]) {
                  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
                  const px = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w
                  const py = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w
                  const depth =
                    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w
                  expect(Math.abs(px)).toBeLessThanOrEqual(0.860001)
                  expect(Math.abs(py)).toBeLessThanOrEqual(0.860001)
                  expect(depth).toBeGreaterThan(0)
                  expect(depth).toBeLessThan(1)
                }
            expect(
              [...camera.eye, ...camera.inverse].every(Number.isFinite),
            ).toBe(true)
            const moveX = shot.target[0] - shot.source[0],
              moveZ = shot.target[2] - shot.source[2]
            const eyeX = camera.eye[0]! - camera.target[0],
              eyeZ = camera.eye[2]! - camera.target[2]
            expect(moveZ * eyeX - moveX * eyeZ).toBeGreaterThan(0)
          }
    },
  )

  it('replays exactly, stops camera motion at the end and avoids a single-frame cut', () => {
    const shot = resolveGummyBoardShot(GUMMY_BOARD_SHOTS[0]!)
    expect(gummyBoardShotCamera(shot, 4, 16 / 9)).toEqual(
      gummyBoardShotCamera(shot, 4, 16 / 9),
    )
    expect(gummyBoardShotCamera(shot, 20, 16 / 9)).toEqual(
      gummyBoardShotCamera(shot, 8, 16 / 9),
    )
    expect(gummyBoardShotCamera(shot, NaN, NaN)).toEqual(
      gummyBoardShotCamera(shot, 0, 1),
    )
    let previous = gummyBoardShotCamera(shot, 0, 16 / 9)
    for (let tick = 1; tick <= 480; tick++) {
      const next = gummyBoardShotCamera(shot, tick / 60, 16 / 9)
      expect(
        Math.hypot(...next.eye.map((v, axis) => v - previous.eye[axis]!)),
      ).toBeLessThan(0.3)
      previous = next
    }
  })
})
