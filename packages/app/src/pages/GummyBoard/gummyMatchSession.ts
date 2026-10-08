/** Validated session recovery and a reloadable handoff from a legal match capture to the cinema. */
import { exportChessPgn, importChessPgn, } from '@chaos-master/core/chess/chessGame'
import { GUMMY_BOARD_EARLY_SHEAR_MOTION } from '@/components/GummyBoard/gummyBoardShots'
import { gummyMatchPalettes } from '@/components/GummyBoard/gummyMatchPresentation'
import { defaultGummyMatchAppearance, validateGummyMatchAppearance, } from './gummyMatchAppearance'
import { createGummyMatchCaptures, matchesGummyCapture, parseGummyMatchCaptures, } from './gummyMatchCaptures'
import type { GummyMatchAppearance } from './gummyMatchAppearance'
import type { GummyMatchCapturePresentation } from './gummyMatchCaptures'

export { defaultGummyMatchAppearance } from './gummyMatchAppearance'
export type { GummyMatchAppearance } from './gummyMatchAppearance'
import { createGummyPreset } from '../GummyBear/gummyPresets'
import { createGummyCinemaRecipe, parseGummyCinemaRecipe, } from './gummyCinemaRecipe'
import type { ChessGame, ChessMoveReceipt, } from '@chaos-master/core/chess/chessGame'
import type { GummyPresetSettings } from '../GummyBear/gummyPresets'
import type { GummyCinemaRecipe } from './gummyCinemaRecipe'
import type { GummyBoardQuality } from '@/components/GummyBoard/gummyBoardQuality'
import type { GummyBoardTheme } from '@/components/GummyBoard/gummyBoardThemes'

export const GUMMY_MATCH_SESSION_KEY = 'gummy-match-session-v1'
export const GUMMY_MATCH_CINEMA_KEY = 'gummy-match-cinema-v1'
type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type GummyMatchSession = {
  game: ChessGame
  cursor: number
  headers: Record<string, string>
  appearance?: GummyMatchAppearance
  captures?: GummyMatchCapturePresentation[]
}

export function loadGummyMatchSession(storage?: SessionStorage): {
  session?: GummyMatchSession
  error?: string
} {
  try {
    const json = (storage ?? globalThis.sessionStorage).getItem(
      GUMMY_MATCH_SESSION_KEY,
    )
    if (!json) return {}
    if (json.length > 1_000_000)
      throw new Error('The saved match is too large.')
    const value: unknown = JSON.parse(json)
    if (!value || typeof value !== 'object')
      throw new Error('Invalid saved match.')
    const data = value as Record<string, unknown>
    if (
      (data.version !== 1 && data.version !== 2) ||
      typeof data.pgn !== 'string' ||
      !Number.isInteger(data.cursor)
    )
      throw new Error('Invalid saved match.')
    const imported = importChessPgn(data.pgn)
    const cursor = data.cursor as number
    if (cursor < 0 || cursor > imported.game.history.length)
      throw new Error('Invalid saved match position.')
    const session: GummyMatchSession = { ...imported, cursor }
    const notices: string[] = []
    if (data.appearance !== undefined) {
      try {
        session.appearance = validateGummyMatchAppearance(data.appearance)
      } catch {
        notices.push(
          'The game was restored, but its board settings were invalid. Default materials are shown.',
        )
      }
    }
    const appearance = session.appearance ?? defaultGummyMatchAppearance()
    if (data.version === 2) {
      try {
        const captures = parseGummyMatchCaptures(data.captures, imported.game)
        // Missing entries use the previous motion, rather than choosing a new effect on reload.
        session.captures = createGummyMatchCaptures(
          imported.game,
          appearance,
          true,
        ).map(
          (fallback) =>
            captures.find((entry) => entry.ply === fallback.ply) ?? fallback,
        )
      } catch {
        session.captures = createGummyMatchCaptures(
          imported.game,
          appearance,
          true,
        )
        notices.push(
          'The game was restored, but its saved capture effects were invalid. Earlier capture motion is available.',
        )
      }
    } else
      session.captures = createGummyMatchCaptures(
        imported.game,
        appearance,
        true,
      )
    return { session, ...(notices.length ? { error: notices.join(' ') } : {}) }
  } catch {
    return {
      error: 'The saved match could not be restored. A new board is ready.',
    }
  }
}

export function saveGummyMatchSession(
  session: GummyMatchSession,
  storage?: SessionStorage,
) {
  ;(storage ?? globalThis.sessionStorage).setItem(
    GUMMY_MATCH_SESSION_KEY,
    JSON.stringify({
      version: 2,
      pgn: exportChessPgn(session.game, session.headers),
      cursor: session.cursor,
      captures: parseGummyMatchCaptures(
        session.captures ??
          createGummyMatchCaptures(
            session.game,
            session.appearance ?? defaultGummyMatchAppearance(),
            true,
          ),
        session.game,
      ),
      appearance: session.appearance
        ? validateGummyMatchAppearance(session.appearance)
        : undefined,
    }),
  )
}

export function gummyMatchCinemaReason(
  receipt?: ChessMoveReceipt,
): string | undefined {
  if (!receipt) return 'Choose a capture in the move history to make a shot.'
  if (!receipt.captured)
    return 'This move has no capture. Choose a move that takes a piece.'
  if (receipt.kind === 'en-passant')
    return 'En-passant plays on this board. Its offset capture is not available in the shot studio yet.'
  if (receipt.kind === 'promotion')
    return 'Promotion plays on this board. Its changing shape is not available in the shot studio yet.'
  return undefined
}

export function createGummyMatchCinemaRecipe(
  receipt: ChessMoveReceipt,
  options: {
    settings: GummyPresetSettings
    quality: GummyBoardQuality
    scale: number
    theme: GummyBoardTheme
    authoredPawn?: GummyMatchAppearance['authoredPawn']
  },
  presentation?: GummyMatchCapturePresentation,
): GummyCinemaRecipe {
  const reason = gummyMatchCinemaReason(receipt)
  if (reason) throw new Error(reason)
  if (presentation && !matchesGummyCapture(presentation, receipt))
    throw new Error('The saved effect belongs to another capture.')
  const look = presentation?.appearance ?? options
  const attacker = receipt.before.pieces.find(
    (piece) => piece.id === receipt.pieceId,
  )!
  const palettes = gummyMatchPalettes(look.settings.palette)
  const title = `${attacker.role[0]!.toUpperCase()}${attacker.role.slice(1)} takes ${receipt.captured!.role}`
  const recipe = createGummyCinemaRecipe({
    id: `match-capture-${receipt.ply}`,
    title,
    fen: receipt.before.fen,
    from: receipt.from,
    to: receipt.to,
    boardTheme: look.theme,
    presetId: 'rockgummy',
    cameraStyle: 'arc',
    motion: presentation?.motion ?? { ...GUMMY_BOARD_EARLY_SHEAR_MOTION },
    ...(presentation?.mechanic ? { mechanic: presentation.mechanic } : {}),
  })
  return parseGummyCinemaRecipe({
    ...recipe,
    material: createGummyPreset('Match material', look.settings).settings,
    scale: look.scale,
    quality: look.quality,
    attackerPalette: attacker.color === 'w' ? palettes[0] : palettes[1],
    victimPalette: receipt.captured!.color === 'w' ? palettes[0] : palettes[1],
    authoredPawn: look.authoredPawn,
  })
}

export function saveGummyMatchCinemaRecipe(
  recipe: GummyCinemaRecipe,
  storage?: SessionStorage,
) {
  ;(storage ?? globalThis.sessionStorage).setItem(
    GUMMY_MATCH_CINEMA_KEY,
    JSON.stringify(parseGummyCinemaRecipe(recipe)),
  )
}

export function readGummyMatchCinemaRecipe(storage?: SessionStorage): {
  recipe?: GummyCinemaRecipe
  error?: string
} {
  try {
    const source = storage ?? globalThis.sessionStorage
    const json = source.getItem(GUMMY_MATCH_CINEMA_KEY)
    if (!json) throw new Error('The match shot is missing.')
    if (json.length > 30_000) throw new Error('The saved shot is too large.')
    const recipe = parseGummyCinemaRecipe(json)
    return { recipe }
  } catch {
    return {
      error:
        'The match shot could not be opened. Return to the match and choose the capture again.',
    }
  }
}
