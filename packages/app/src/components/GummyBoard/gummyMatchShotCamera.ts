/** Ease from the player's board camera into a capture and back without changing studio shots. */
import { mat4 } from 'wgpu-matrix'
import { gummyBoardCameraMatrices, gummyBoardCameraRadius, } from './gummyBoardCamera'
import { gummyBoardShotCamera } from './gummyBoardShotCamera'
import { GUMMY_BOARD_SHOT_DURATION } from './gummyBoardShots'
import type { ResolvedGummyBoardShot } from './gummyBoardShots'
import type { GummyOrbit, GummyVec3, } from '@/components/GummyBear/gummyStudyMath'

const TRANSITION_SECONDS = 0.8

function smootherstep(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function gummyMatchShotCamera(
  resolved: ResolvedGummyBoardShot,
  displayTime: number,
  aspect: number,
  pieceScale: number,
  orbit: GummyOrbit,
): ReturnType<typeof gummyBoardShotCamera> {
  const time = Number.isFinite(displayTime)
    ? Math.max(0, Math.min(GUMMY_BOARD_SHOT_DURATION, displayTime))
    : 0
  const fittedAspect = Number.isFinite(aspect) ? Math.max(0.25, aspect) : 1
  const shot = gummyBoardShotCamera(resolved, time, fittedAspect, pieceScale)
  if (
    time >= TRANSITION_SECONDS &&
    time <= GUMMY_BOARD_SHOT_DURATION - TRANSITION_SECONDS
  )
    return shot

  const blend = smootherstep(
    Math.min(time, GUMMY_BOARD_SHOT_DURATION - time) / TRANSITION_SECONDS,
  )
  const target: GummyVec3 = [
    orbit.pan?.[0] ?? 0,
    0.8 + (orbit.pan?.[1] ?? 0),
    orbit.pan?.[2] ?? 0,
  ]
  const eye = new Float32Array(3),
    view = new Float32Array(16),
    projection = new Float32Array(16),
    viewProjection = new Float32Array(16),
    inverse = new Float32Array(16)
  gummyBoardCameraMatrices(
    orbit,
    fittedAspect,
    'board',
    viewProjection,
    inverse,
    eye,
    view,
    projection,
  )
  let radius = gummyBoardCameraRadius(orbit, fittedAspect, 'board')
  if (blend > 0) {
    for (let axis = 0; axis < 3; axis++) {
      eye[axis] = eye[axis]! + (shot.eye[axis]! - eye[axis]!) * blend
      target[axis] =
        target[axis]! + (shot.target[axis]! - target[axis]!) * blend
    }
    radius = Math.hypot(...eye.map((value, axis) => value - target[axis]!))
    mat4.lookAt(eye, target, [0, 1, 0], view)
    mat4.mul(projection, view, viewProjection)
    mat4.inverse(viewProjection, inverse)
  }
  return {
    ...shot,
    target,
    eye,
    radius,
    view,
    projection,
    viewProjection,
    inverse,
  }
}
