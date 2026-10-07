/** Pin match camera handoffs to the real board camera and preserve the middle of each studio shot. */
import { describe, expect, it } from 'vitest'
import { mat4 } from 'wgpu-matrix'
import { gummyBoardCameraMatrices, initialGummyBoardOrbit, } from './gummyBoardCamera'
import { gummyBoardShotCamera } from './gummyBoardShotCamera'
import { GUMMY_BOARD_SHOTS, resolveGummyBoardShot } from './gummyBoardShots'
import { gummyMatchShotCamera } from './gummyMatchShotCamera'
import type { GummyOrbit } from '@/components/GummyBear/gummyStudyMath'

const orbit: GummyOrbit = {
  ...initialGummyBoardOrbit('board'),
  theta: -0.6,
  phi: 1.1,
  zoom: 1.2,
  pan: [0.6, -0.2, 1.3],
}

function boardCamera(aspect: number) {
  const eye = new Float32Array(3),
    view = new Float32Array(16),
    projection = new Float32Array(16),
    viewProjection = new Float32Array(16),
    inverse = new Float32Array(16)
  gummyBoardCameraMatrices(
    orbit,
    aspect,
    'board',
    viewProjection,
    inverse,
    eye,
    view,
    projection,
  )
  return { eye, view, projection, viewProjection, inverse }
}

describe('match capture camera', () => {
  it.each([9 / 16, 1, 16 / 9])(
    'returns exactly to the panned and zoomed board at aspect %s',
    (aspect) => {
      const shot = resolveGummyBoardShot(GUMMY_BOARD_SHOTS[0]!)
      const expected = boardCamera(aspect)
      for (const time of [-1, 0, 8, 10]) {
        const camera = gummyMatchShotCamera(shot, time, aspect, 0.9, orbit)
        expect(camera.target[0]).toBe(0.6)
        expect(camera.target[1]).toBeCloseTo(0.6, 12)
        expect(camera.target[2]).toBe(1.3)
        expect(camera.eye).toEqual(expected.eye)
        expect(camera.viewProjection).toEqual(expected.viewProjection)
        expect(camera.inverse).toEqual(expected.inverse)
      }
    },
  )

  it.each(GUMMY_BOARD_SHOTS)(
    'preserves the central cinematic path of $id',
    (definition) => {
      const shot = resolveGummyBoardShot(definition)
      for (const time of [0.8, 2, 4, 6, 7.2])
        expect(gummyMatchShotCamera(shot, time, 16 / 9, 0.95, orbit)).toEqual(
          gummyBoardShotCamera(shot, time, 16 / 9, 0.95),
        )
    },
  )

  it('moves eye and target halfway at the transition midpoint, preserving a valid camera', () => {
    const shot = resolveGummyBoardShot(GUMMY_BOARD_SHOTS[0]!)
    const board = boardCamera(9 / 16)
    const close = gummyBoardShotCamera(shot, 0.4, 9 / 16, 0.9)
    const camera = gummyMatchShotCamera(shot, 0.4, 9 / 16, 0.9, orbit)
    for (let axis = 0; axis < 3; axis++) {
      expect(camera.eye[axis]).toBeCloseTo(
        (board.eye[axis]! + close.eye[axis]!) / 2,
        5,
      )
      expect(camera.target[axis]).toBeCloseTo(
        ([0.6, 0.6, 1.3][axis]! + close.target[axis]!) / 2,
        10,
      )
    }
    expect(camera.viewProjection).not.toEqual(board.viewProjection)
    expect(camera.viewProjection).not.toEqual(close.viewProjection)
    const identity = mat4.mul(camera.viewProjection, camera.inverse)
    for (let index = 0; index < 16; index++)
      expect(identity[index]).toBeCloseTo(index % 5 === 0 ? 1 : 0, 3)
  })

  it('keeps portrait matrices finite throughout both transitions and normalizes invalid time/aspect', () => {
    const shot = resolveGummyBoardShot(GUMMY_BOARD_SHOTS[1]!)
    for (let tick = 0; tick <= 480; tick++) {
      const camera = gummyMatchShotCamera(shot, tick / 60, 9 / 16, 0.85, orbit)
      expect(
        [...camera.eye, ...camera.viewProjection, ...camera.inverse].every(
          Number.isFinite,
        ),
      ).toBe(true)
    }
    expect(gummyMatchShotCamera(shot, NaN, NaN, 0.9, orbit)).toEqual(
      gummyMatchShotCamera(shot, 0, 1, 0.9, orbit),
    )
  })
})
