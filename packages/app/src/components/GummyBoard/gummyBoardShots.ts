/** Composed capture scenes share legal positions and a deterministic six-second physical action. */
import { GUMMY_CHESS_MOULDS } from '@/simulation/gummy/gummyChessMoulds'
import { parseGummyBoardFen, validateGummyBoardCapture, } from './gummyBoardPosition'
import type { GummyBoardPhase } from './gummyBoardChoreography'
import type { GummyVec3 } from '@/components/GummyBear/gummyStudyMath'

export { gummyBoardSquare, parseGummyBoardFen } from './gummyBoardPosition'
export {
  GUMMY_BOARD_ORIGINAL_MOTION,
  GUMMY_BOARD_EARLY_SHEAR_MOTION,
  GUMMY_BOARD_MOTION_RANGES,
  resolveGummyBoardShotMotion,
} from './gummyCaptureMotion'
export type { GummyBoardShotMotion } from './gummyCaptureMotion'
import { parseGummyCaptureMechanic } from './gummyCaptureMechanics'
import { GUMMY_BOARD_ORIGINAL_MOTION, resolveGummyBoardShotMotion, } from './gummyCaptureMotion'
import type { GummyCaptureMechanic } from './gummyCaptureMechanics'
import type { GummyBoardShotMotion } from './gummyCaptureMotion'

export type GummyBoardShot = {
  id: string
  title: string
  fen: string
  from: string
  to: string
  boardTheme: 'classic' | 'glass' | 'lava'
  presetId: string
  cameraStyle: 'arc' | 'diagonal' | 'hero'
  motion?: GummyBoardShotMotion
  mechanic?: GummyCaptureMechanic
}

/** These are independent composed positions, not a recorded or historical game. */
export const GUMMY_BOARD_SHOTS: readonly GummyBoardShot[] = [
  {
    id: 'pawn-knight',
    title: 'Pawn takes knight',
    fen: '6k1/pp3ppp/4p3/3n4/4P3/8/PP3PPP/6K1 w - - 0 24',
    from: 'e4',
    to: 'd5',
    boardTheme: 'classic',
    presetId: 'mid',
    cameraStyle: 'arc',
  },
  {
    id: 'bishop-rook',
    title: 'Bishop takes rook',
    fen: '6k1/pp3r1p/6p1/8/2B5/8/PP3PPP/6K1 w - - 0 28',
    from: 'c4',
    to: 'f7',
    boardTheme: 'glass',
    presetId: 'rockgummy',
    cameraStyle: 'diagonal',
  },
  {
    id: 'queen-rook',
    title: 'Queen takes rook',
    fen: '6k1/p2r3p/6p1/8/8/3Q4/PP3PPP/6K1 w - - 0 31',
    from: 'd3',
    to: 'd7',
    boardTheme: 'lava',
    presetId: 'high',
    cameraStyle: 'hero',
  },
]
export const GUMMY_BOARD_SHOT_DURATION = 8
export const GUMMY_BOARD_SHOT_SIMULATION_DURATION = 6

export function resolveGummyBoardShot(shot: GummyBoardShot) {
  const motion = resolveGummyBoardShotMotion(shot.motion)
  if (shot.mechanic) parseGummyCaptureMechanic(shot.mechanic)
  const position = parseGummyBoardFen(shot.fen)
  const { attacker, victim } = validateGummyBoardCapture(
    position,
    shot.from,
    shot.to,
  )
  return {
    shot: { ...shot, motion: { ...motion } },
    motion,
    pieces: position.pieces,
    attacker,
    victim,
    source: [...attacker.position] as GummyVec3,
    target: [...victim.position] as GummyVec3,
    duration: GUMMY_BOARD_SHOT_DURATION,
    simulationDuration: GUMMY_BOARD_SHOT_SIMULATION_DURATION,
  }
}
export type ResolvedGummyBoardShot = ReturnType<typeof resolveGummyBoardShot>

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
const smoothIntegral = (t: number) => t * t * t - (t * t * t * t) / 2

/** Earlier sweeps retain the original downward press and return to the captured square. */
function applyShotShear(
  position: GummyVec3,
  resolved: ResolvedGummyBoardShot,
  time: number,
  scale: number,
): GummyVec3 {
  const { motion, source, target } = resolved
  if (
    time < 2.3 ||
    (motion.contactHold === 0 &&
      motion.shearOnset === GUMMY_BOARD_ORIGINAL_MOTION.shearOnset &&
      motion.shearDistance === GUMMY_BOARD_ORIGINAL_MOTION.shearDistance &&
      (motion.shearSign ?? 1) === 1 &&
      !motion.twistAngle)
  )
    return position
  const start = 2.3 + 1.2 * motion.shearOnset
  const returnStart = 3.9 + motion.contactHold
  const blend =
    time < returnStart
      ? smooth((time - start) / 0.4)
      : 1 - smooth((time - returnStart) / 0.4)
  const travelX = target[0] - source[0]
  const travelZ = target[2] - source[2]
  const rocking = (motion.twistAngle ?? 0) > 0
  const dx = rocking ? -travelZ : travelX
  const dz = rocking ? travelX : travelZ
  const envelope = rocking
    ? rockEnvelope(time, motion.contactHold, motion.shearOnset)
    : blend
  const distance =
    (motion.shearDistance * scale * envelope * (motion.shearSign ?? 1)) /
    Math.hypot(dx, dz)
  return [target[0] + dx * distance, position[1], target[2] + dz * distance]
}

/** Alternating, eased contact turns end at the exact saved heading. */
function rockEnvelope(time: number, hold: number, onset: number) {
  const knots = [
    [2.3 + 0.4 * onset, 0],
    [2.8 + hold / 2 + 0.2 * onset, 1],
    [3.4 + hold + 0.1 * onset, -0.7],
    [3.9 + hold, 0.3],
    [4.3 + hold, 0],
  ] as const
  if (!Number.isFinite(time) || time <= knots[0][0]) return 0
  for (let i = 1; i < knots.length; i++) {
    const previous = knots[i - 1]!,
      next = knots[i]!
    if (time < next[0])
      return (
        previous[1] +
        (next[1] - previous[1]) *
          smooth((time - previous[0]) / (next[0] - previous[0]))
      )
  }
  return 0
}

/** Delta yaw relative to the mould's baked board orientation, shared by render and contact. */
export function gummyBoardShotRotation(
  resolved: ResolvedGummyBoardShot,
  simulationTime: number,
) {
  const angle =
    (resolved.motion.twistAngle ?? 0) *
    (resolved.motion.shearSign ?? 1) *
    rockEnvelope(
      simulationTime,
      resolved.motion.contactHold,
      resolved.motion.shearOnset,
    )
  return angle === 0 ? 0 : angle
}

/** Short velocity ramps leave enough travel time for the longest legal diagonal at 85% scale. */
function travelBlend(value: number) {
  const t = Math.max(0, Math.min(1, value))
  const ramp = 0.15
  // The velocity trapezoid integrates to 1-ramp; normalize its integral, not the final velocity.
  if (t < ramp) return (t * t) / (2 * ramp * (1 - ramp))
  if (t > 1 - ramp) return 1 - ((1 - t) * (1 - t)) / (2 * ramp * (1 - ramp))
  return (t - ramp / 2) / (1 - ramp)
}

/** A C1 rate ramp spends two extra display seconds around contact without changing the physics timestep. */
export function gummyBoardShotSimulationTime(displayTime: number) {
  const time = Number.isFinite(displayTime) ? Math.max(0, displayTime) : 0
  if (time >= GUMMY_BOARD_SHOT_DURATION)
    return GUMMY_BOARD_SHOT_SIMULATION_DURATION
  if (time < 2) return time
  if (time < 2.5) {
    const t = (time - 2) / 0.5
    return 2 + 0.5 * (t - 0.75 * smoothIntegral(t))
  }
  const rampUpStart = 2.5 + 13 / 6
  if (time < rampUpStart) return 2.3125 + (time - 2.5) * 0.25
  const rampUpSimulationStart = 2.3125 + 13 / 24
  if (time < rampUpStart + 0.5) {
    const t = (time - rampUpStart) / 0.5
    return rampUpSimulationStart + 0.5 * (0.25 * t + 0.75 * smoothIntegral(t))
  }
  return time - 2
}

/** World-space translation; callers convert this to the victim solver's local coordinates once. */
export function gummyBoardShotPose(
  resolved: ResolvedGummyBoardShot,
  simulationTime: number,
  pieceScale = 0.9,
): { position: GummyVec3; phase: GummyBoardPhase } {
  if (!Number.isFinite(pieceScale) || pieceScale <= 0)
    throw new RangeError('Piece scale must be positive and finite.')
  const { source, target } = resolved
  const height =
    (GUMMY_CHESS_MOULDS[resolved.victim.mould].bounds.max[1] + 0.5) * pieceScale
  const dx = target[0] - source[0],
    dz = target[2] - source[2]
  const length = Math.hypot(dx, dz)
  const finish: GummyVec3 = [
    target[0],
    target[1] + 0.24 * pieceScale,
    target[2],
  ]
  if (simulationTime >= GUMMY_BOARD_SHOT_SIMULATION_DURATION)
    return { position: finish, phase: 'complete' }
  const compressed: GummyVec3 = [
    target[0],
    target[1] + 0.3 * pieceScale,
    target[2],
  ]
  const halfPressed: GummyVec3 = [
    target[0],
    (target[1] + height + compressed[1]) / 2,
    target[2],
  ]
  type Stage = { seconds: number; to: GummyVec3; phase: GummyBoardPhase }
  // Splitting the descent eases to rest on both sides of the optional hold.
  // The unchanged zero-hold stage preserves the original trajectory exactly.
  const press: Stage[] =
    resolved.motion.contactHold > 0
      ? [
          { seconds: 0.425, to: halfPressed, phase: 'crushing' },
          {
            seconds: resolved.motion.contactHold,
            to: halfPressed,
            phase: 'crushing',
          },
          { seconds: 0.425, to: compressed, phase: 'crushing' },
        ]
      : [{ seconds: 0.85, to: compressed, phase: 'crushing' }]
  const stages: { seconds: number; to: GummyVec3; phase: GummyBoardPhase }[] = [
    { seconds: 0.4, to: source, phase: 'ready' },
    {
      seconds: 1.1,
      to: [source[0], target[1] + height, source[2]],
      phase: 'lifting',
    },
    {
      seconds: 0.8,
      to: [target[0], target[1] + height, target[2]],
      phase: 'aiming',
    },
    ...press,
    { seconds: 0.35, to: compressed, phase: 'crushing' },
    {
      seconds: 0.4,
      to: [
        target[0] + (0.18 * pieceScale * dx) / length,
        target[1] + 0.28 * pieceScale,
        target[2] + (0.18 * pieceScale * dz) / length,
      ],
      phase: 'crushing',
    },
    { seconds: 0.4, to: finish, phase: 'settling' },
    {
      seconds: 1.7 - resolved.motion.contactHold,
      to: finish,
      phase: 'settling',
    },
  ]
  let remaining = Number.isFinite(simulationTime)
    ? Math.max(0, simulationTime)
    : 0
  let from = source
  for (const stage of stages) {
    if (remaining < stage.seconds) {
      const blend =
        stage.phase === 'aiming'
          ? travelBlend(remaining / stage.seconds)
          : smooth(remaining / stage.seconds)
      return {
        position: applyShotShear(
          from.map((v, axis) => v + (stage.to[axis]! - v) * blend) as GummyVec3,
          resolved,
          Number.isFinite(simulationTime) ? Math.max(0, simulationTime) : 0,
          pieceScale,
        ),
        phase: stage.phase,
      }
    }
    remaining -= stage.seconds
    from = stage.to
  }
  return { position: [...finish], phase: 'complete' }
}

/** The prescribed velocity ends on the same pose that is rendered after a fixed tick. */
export function gummyBoardShotStep(
  resolved: ResolvedGummyBoardShot,
  time: number,
  dt: number,
  pieceScale = 0.9,
) {
  if (!Number.isFinite(dt) || dt <= 0)
    throw new RangeError('A capture step needs a positive finite timestep.')
  const start = gummyBoardShotPose(resolved, time, pieceScale)
  const end = gummyBoardShotPose(resolved, time + dt, pieceScale)
  return {
    position: start.position,
    velocity: start.position.map(
      (value, axis) => (end.position[axis]! - value) / dt,
    ) as GummyVec3,
    rotationY: gummyBoardShotRotation(resolved, time),
    angularVelocityY:
      (gummyBoardShotRotation(resolved, time + dt) -
        gummyBoardShotRotation(resolved, time)) /
      dt,
    friction: 0.45,
  }
}
