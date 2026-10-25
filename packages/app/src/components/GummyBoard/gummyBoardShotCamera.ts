/** Deterministic camera arcs keep both actors in frame across landscape and portrait shots. */
import { mat4 } from 'wgpu-matrix'
import { GUMMY_CHESS_MOULDS } from '@/simulation/gummy/gummyChessMoulds'
import { GUMMY_BOARD_SHOT_DURATION, gummyBoardShotPose, gummyBoardShotSimulationTime, } from './gummyBoardShots'
import type { GummyBoardPiece } from './gummyBoardChoreography'
import type { ResolvedGummyBoardShot } from './gummyBoardShots'
import type { GummyVec3 } from '@/components/GummyBear/gummyStudyMath'

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

function actorBounds(
  piece: GummyBoardPiece,
  position: GummyVec3,
  scale: number,
) {
  const { min, max } = GUMMY_CHESS_MOULDS[piece.mould].bounds
  const result = {
    min: [Infinity, Infinity, Infinity] as GummyVec3,
    max: [-Infinity, -Infinity, -Infinity] as GummyVec3,
  }
  const c = Math.cos(piece.rotationY),
    s = Math.sin(piece.rotationY)
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const world = [
          position[0] + (x * c + z * s) * scale,
          position[1] + y * scale,
          position[2] + (-x * s + z * c) * scale,
        ]
        for (let axis = 0; axis < 3; axis++) {
          result.min[axis] = Math.min(result.min[axis]!, world[axis]!)
          result.max[axis] = Math.max(result.max[axis]!, world[axis]!)
        }
      }
  return result
}

export function gummyBoardShotCamera(
  resolved: ResolvedGummyBoardShot,
  displayTime: number,
  aspect: number,
  pieceScale = 0.9,
) {
  const time = Number.isFinite(displayTime)
    ? Math.max(0, Math.min(GUMMY_BOARD_SHOT_DURATION, displayTime))
    : 0
  const fittedAspect = Number.isFinite(aspect) ? Math.max(0.25, aspect) : 1
  const simulationTime = gummyBoardShotSimulationTime(time)
  const pose = gummyBoardShotPose(resolved, simulationTime, pieceScale)
  const attacker = actorBounds(resolved.attacker, pose.position, pieceScale)
  const victim = actorBounds(resolved.victim, resolved.target, pieceScale)
  // Reserve space for the reconstructed skin and for the first outward spread of jelly.
  const margin = 0.2 + 0.8 * smooth((simulationTime - 2.3) / 1.1)
  const bounds = {
    min: attacker.min.map(
      (value, axis) => Math.min(value, victim.min[axis]!) - margin,
    ) as GummyVec3,
    max: attacker.max.map(
      (value, axis) => Math.max(value, victim.max[axis]!) + margin,
    ) as GummyVec3,
  }
  const target = bounds.min.map(
    (value, axis) => (value + bounds.max[axis]!) / 2,
  ) as GummyVec3
  const progress = smooth(time / GUMMY_BOARD_SHOT_DURATION)
  const direction = Math.atan2(
    resolved.target[0] - resolved.source[0],
    resolved.target[2] - resolved.source[2],
  )
  const style = resolved.shot.cameraStyle
  // Stay on one side of the move axis throughout the shot, so screen direction never reverses.
  const theta =
    direction +
    Math.PI / 2 +
    (style === 'arc'
      ? -0.22 + 0.44 * progress
      : style === 'diagonal'
        ? -0.12 + 0.24 * progress
        : 0.12 + 0.12 * progress)
  const phi =
    (style === 'hero' ? 1.04 : 0.9) + 0.12 * smooth((time - 0.4) / 3.4)
  const sp = Math.sin(phi),
    cp = Math.cos(phi),
    st = Math.sin(theta),
    ct = Math.cos(theta)
  const tangent = Math.tan(Math.PI / 8) * 0.86
  let radius = 0
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const dx = x - target[0],
          dy = y - target[1],
          dz = z - target[2]
        const depth = dx * sp * st + dy * cp + dz * sp * ct
        radius = Math.max(
          radius,
          depth + Math.abs(dx * ct - dz * st) / (tangent * fittedAspect),
          depth + Math.abs(-dx * cp * st + dy * sp - dz * cp * ct) / tangent,
        )
      }
  radius *= 1 + 0.12 * (1 - smooth(time / 3.4))
  const eye = new Float32Array([
    target[0] + radius * sp * st,
    target[1] + radius * cp,
    target[2] + radius * sp * ct,
  ])
  const view = new Float32Array(16),
    projection = new Float32Array(16),
    viewProjection = new Float32Array(16),
    inverse = new Float32Array(16)
  mat4.lookAt(eye, target, [0, 1, 0], view)
  mat4.perspective(Math.PI / 4, fittedAspect, 0.05, 150, projection)
  mat4.mul(projection, view, viewProjection)
  mat4.inverse(viewProjection, inverse)
  return {
    eye,
    target,
    radius,
    bounds,
    view,
    projection,
    viewProjection,
    inverse,
  }
}
