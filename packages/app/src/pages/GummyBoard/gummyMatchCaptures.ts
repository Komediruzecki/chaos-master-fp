/** Persist capture choreography beside legal move receipts, including the material used at capture time. */
import { GUMMY_BOARD_EARLY_SHEAR_MOTION, resolveGummyBoardShotMotion, } from '@/components/GummyBoard/gummyBoardShots'
import { chooseGummyCaptureMechanic, gummyCaptureMechanicContext, parseGummyCaptureMechanic, } from '@/components/GummyBoard/gummyCaptureMechanics'
import { gummyMatchCaptureShot } from '@/components/GummyBoard/gummyMatchPresentation'
import { validateGummyMatchAppearance } from './gummyMatchAppearance'
import type { ChessGame, ChessMoveReceipt, } from '@chaos-master/core/chess/chessGame'
import type { GummyMatchAppearance } from './gummyMatchAppearance'
import type { GummyBoardShotMotion } from '@/components/GummyBoard/gummyBoardShots'
import type { GummyCaptureMechanic } from '@/components/GummyBoard/gummyCaptureMechanics'

export type GummyMatchCapturePresentation = {
  version: 1
  ply: number
  beforeFen: string
  lan: string
  mechanic?: GummyCaptureMechanic
  motion: GummyBoardShotMotion
  appearance: GummyMatchAppearance
}

export function matchesGummyCapture(
  presentation: GummyMatchCapturePresentation,
  receipt: ChessMoveReceipt,
) {
  return (
    presentation.ply === receipt.ply &&
    presentation.beforeFen === receipt.before.fen &&
    presentation.lan === receipt.lan
  )
}

/** Stable, non-security seed: importing the same game with the same settings yields the same choreography. */
function captureSeed(receipt: ChessMoveReceipt) {
  let seed = 2166136261
  for (const char of `${receipt.before.fen}|${receipt.ply}|${receipt.lan}`) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0
  }
  return seed
}

export function createGummyMatchCapturePresentation(
  receipt: ChessMoveReceipt,
  appearance: GummyMatchAppearance,
  previous?: GummyMatchCapturePresentation,
  legacy = false,
): GummyMatchCapturePresentation | undefined {
  const shot = gummyMatchCaptureShot(receipt, appearance.theme)
  if (!shot) return undefined
  const choice = legacy
    ? undefined
    : chooseGummyCaptureMechanic(
        captureSeed(receipt),
        previous?.mechanic?.id,
        gummyCaptureMechanicContext(shot, appearance.scale),
      )
  return {
    version: 1,
    ply: receipt.ply,
    beforeFen: receipt.before.fen,
    lan: receipt.lan,
    ...(choice ? { mechanic: choice.mechanic } : {}),
    motion: choice?.motion ?? { ...GUMMY_BOARD_EARLY_SHEAR_MOTION },
    appearance: validateGummyMatchAppearance(appearance),
  }
}

/** Used once for imported games or v1 recovery; never from a frame callback. */
export function createGummyMatchCaptures(
  game: ChessGame,
  appearance: GummyMatchAppearance,
  legacy = false,
) {
  const captures: GummyMatchCapturePresentation[] = []
  for (const receipt of game.history) {
    const presentation = createGummyMatchCapturePresentation(
      receipt,
      appearance,
      captures.at(-1),
      legacy,
    )
    if (presentation) captures.push(presentation)
  }
  return captures
}

/** Match every saved envelope to the PGN receipt before accepting any presentation data. */
export function parseGummyMatchCaptures(value: unknown, game: ChessGame) {
  if (!Array.isArray(value) || value.length > game.history.length)
    throw new Error('Invalid saved captures.')
  const seen = new Set<number>()
  return value
    .map((entry: unknown): GummyMatchCapturePresentation => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new Error('Invalid saved capture.')
      const data = entry as Record<string, unknown>
      if (
        data.version !== 1 ||
        data.motion === undefined ||
        typeof data.ply !== 'number' ||
        !Number.isInteger(data.ply) ||
        seen.has(data.ply)
      )
        throw new Error('Invalid saved capture.')
      const receipt = game.history[data.ply - 1]
      if (
        !receipt ||
        receipt.before.fen !== data.beforeFen ||
        receipt.lan !== data.lan
      )
        throw new Error('Saved capture does not match the game.')
      const appearance = validateGummyMatchAppearance(data.appearance)
      if (!gummyMatchCaptureShot(receipt, appearance.theme))
        throw new Error('Saved capture has no cinematic move.')
      seen.add(data.ply)
      return {
        version: 1,
        ply: receipt.ply,
        beforeFen: receipt.before.fen,
        lan: receipt.lan,
        ...(data.mechanic === undefined
          ? {}
          : { mechanic: parseGummyCaptureMechanic(data.mechanic) }),
        motion: resolveGummyBoardShotMotion(data.motion),
        appearance,
      }
    })
    .sort((a, b) => a.ply - b.ply)
}
