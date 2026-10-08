/** Seeded physical capture choices with explicit replay parameters and conservative neighbour clearance. */
import { GUMMY_CHESS_MOULDS } from '@/simulation/gummy/gummyChessMoulds'
import { GUMMY_BOARD_GRID } from './gummyBoardGrid'
import { parseGummyBoardFen, validateGummyBoardCapture, } from './gummyBoardPosition'
import { resolveGummyBoardShotMotion } from './gummyCaptureMotion'
import type { GummyBoardPiece } from './gummyBoardChoreography'
import type { GummyBoardShotMotion } from './gummyCaptureMotion'

export const GUMMY_CAPTURE_MECHANICS = [
  {
    id: 'press-settle',
    title: 'Press and settle',
    description: 'Press down, sweep gently and hold the captured square.',
  },
  {
    id: 'shoulder-sweep',
    title: 'Shoulder sweep',
    description: 'Press partway, push sideways and return to the square.',
  },
  {
    id: 'rock-shear',
    title: 'Rock and shear',
    description:
      'Turn back and forth while sweeping through the softened piece.',
  },
] as const
export type GummyCaptureMechanicId =
  (typeof GUMMY_CAPTURE_MECHANICS)[number]['id']
export type GummyCaptureMechanic = {
  version: 1
  id: GummyCaptureMechanicId
  seed: number
}
export type GummyCaptureMechanicContext = {
  maxShearDistance?: number
  maxTwistAngle?: number
}

export function parseGummyCaptureMechanic(
  value: unknown,
): GummyCaptureMechanic {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Capture mechanic needs a version, name and seed.')
  const tag = value as Record<string, unknown>
  if (
    tag.version !== 1 ||
    !GUMMY_CAPTURE_MECHANICS.some(({ id }) => id === tag.id)
  )
    throw new Error('This capture mechanic version or name is unsupported.')
  if (
    typeof tag.seed !== 'number' ||
    !Number.isInteger(tag.seed) ||
    tag.seed < 0 ||
    tag.seed > 0xffffffff
  )
    throw new Error('Capture seed must be an unsigned 32-bit integer.')
  return { version: 1, id: tag.id as GummyCaptureMechanicId, seed: tag.seed }
}

function mixedSeed(seed: number) {
  let value = (seed ^ 0x9e3779b9) >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad)
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97)
  return (value ^ (value >>> 15)) >>> 0
}

function cap(value: number | undefined, maximum: number) {
  if (value === undefined) return maximum
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError('Capture clearance must be finite and nonnegative.')
  return Math.min(value, maximum)
}

export function createGummyCaptureMechanic(
  id: GummyCaptureMechanicId,
  seed = 0,
  context: GummyCaptureMechanicContext = {},
) {
  const mechanic = parseGummyCaptureMechanic({ version: 1, id, seed })
  const sign = mixedSeed(seed) % 2 ? -1 : 1
  const templates: Record<GummyCaptureMechanicId, GummyBoardShotMotion> = {
    'press-settle': { shearOnset: 1, shearDistance: 0.18, contactHold: 0 },
    'shoulder-sweep': {
      shearOnset: 0.12,
      shearDistance: 0.6,
      contactHold: 0.32,
      shearSign: sign,
    },
    'rock-shear': {
      shearOnset: 0,
      shearDistance: 0.34,
      contactHold: 0.2,
      shearSign: sign,
      twistAngle: 0.24,
    },
  }
  const motion = { ...templates[id] }
  motion.shearDistance = Math.min(
    motion.shearDistance,
    cap(context.maxShearDistance, 1.2),
  )
  if (motion.twistAngle !== undefined)
    motion.twistAngle = Math.min(
      motion.twistAngle,
      cap(context.maxTwistAngle, 0.35),
    )
  return { mechanic, motion: resolveGummyBoardShotMotion(motion) }
}

/** Selection happens once per receipt; callers persist both the tag and the resolved motion. */
export function chooseGummyCaptureMechanic(
  seed: number,
  previousId?: GummyCaptureMechanicId,
  context: GummyCaptureMechanicContext = {},
) {
  parseGummyCaptureMechanic({ version: 1, id: 'press-settle', seed })
  const cramped =
    cap(context.maxShearDistance, 1.2) < 0.005 &&
    cap(context.maxTwistAngle, 0.35) < 0.005
  const ids = cramped
    ? ['press-settle' as const]
    : GUMMY_CAPTURE_MECHANICS.map(({ id }) => id).filter(
        (id) => id !== previousId,
      )
  return createGummyCaptureMechanic(
    ids[mixedSeed(seed) % ids.length]!,
    seed,
    context,
  )
}

function footprint(piece: GummyBoardPiece) {
  const { min, max } = GUMMY_CHESS_MOULDS[piece.mould].bounds
  const x = Math.max(Math.abs(min[0]), Math.abs(max[0]))
  const z = Math.max(Math.abs(min[2]), Math.abs(max[2]))
  const c = Math.abs(Math.cos(piece.rotationY ?? 0)),
    s = Math.abs(Math.sin(piece.rotationY ?? 0))
  return { x: x * c + z * s, z: z * c + x * s, radius: Math.hypot(x, z) }
}

/** Reserve half the nearest separating-axis gap for travel and half for yaw expansion.
 * A point moves at most radius * angle under yaw, so the combined envelopes cannot
 * cross any stationary neighbour's conservative footprint during the contact phase.
 */
export function gummyCaptureMechanicContext(
  shot: { fen: string; from: string; to: string },
  scale: number,
): GummyCaptureMechanicContext {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new RangeError('Piece scale must be positive and finite.')
  const position = parseGummyBoardFen(shot.fen)
  const { attacker, victim } = validateGummyBoardCapture(
    position,
    shot.from,
    shot.to,
  )
  const moving = footprint(attacker)
  let clearance =
    Math.min(
      GUMMY_BOARD_GRID.halfExtent -
        Math.abs(victim.position[0]) -
        moving.x * scale,
      GUMMY_BOARD_GRID.halfExtent -
        Math.abs(victim.position[2]) -
        moving.z * scale,
    ) - 0.012
  for (const piece of position.pieces) {
    if (piece.id === attacker.id || piece.id === victim.id) continue
    const fixed = footprint(piece)
    const gapX =
      Math.abs(piece.position[0] - victim.position[0]) -
      (moving.x + fixed.x) * scale
    const gapZ =
      Math.abs(piece.position[2] - victim.position[2]) -
      (moving.z + fixed.z) * scale
    clearance = Math.min(clearance, Math.max(gapX, gapZ) - 0.012)
  }
  const local = Math.max(0, clearance) / scale
  return {
    maxShearDistance: Math.min(1.2, local / 2),
    maxTwistAngle: Math.min(0.35, local / (2 * moving.radius)),
  }
}
