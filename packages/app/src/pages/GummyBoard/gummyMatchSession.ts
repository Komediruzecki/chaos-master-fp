/** Validated session recovery and a reloadable handoff from a legal match capture to the cinema. */
import { exportChessPgn, importChessPgn, } from '@chaos-master/core/chess/chessGame'
import { GUMMY_BOARD_EARLY_SHEAR_MOTION } from '@/components/GummyBoard/gummyBoardShots'
import { gummyMatchPalettes } from '@/components/GummyBoard/gummyMatchPresentation'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
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
export type GummyMatchAppearance = {
  settings: GummyPresetSettings
  quality: GummyBoardQuality
  scale: number
  theme: GummyBoardTheme
}
export type GummyMatchSession = {
  game: ChessGame
  cursor: number
  headers: Record<string, string>
  appearance?: GummyMatchAppearance
}

export function defaultGummyMatchAppearance(): GummyMatchAppearance {
  const preset = GUMMY_BUILTIN_PRESETS.find((item) => item.id === 'rockgummy')!
  return {
    settings: createGummyPreset(preset.preset.name, preset.preset.settings)
      .settings,
    quality: 'auto',
    scale: 0.9,
    theme: 'classic',
  }
}

function validateAppearance(value: unknown): GummyMatchAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid match appearance.')
  const appearance = value as Record<string, unknown>
  if (
    !['auto', 'tablet', 'high'].includes(appearance.quality as string) ||
    !['classic', 'glass', 'lava'].includes(appearance.theme as string) ||
    typeof appearance.scale !== 'number' ||
    !Number.isFinite(appearance.scale) ||
    appearance.scale < 0.85 ||
    appearance.scale > 1
  )
    throw new Error('Invalid match appearance.')
  return {
    settings: createGummyPreset(
      'Match material',
      appearance.settings as GummyPresetSettings,
    ).settings,
    quality: appearance.quality as GummyBoardQuality,
    scale: appearance.scale,
    theme: appearance.theme as GummyBoardTheme,
  }
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
    if (json.length > 150_000) throw new Error('The saved match is too large.')
    const value: unknown = JSON.parse(json)
    if (!value || typeof value !== 'object')
      throw new Error('Invalid saved match.')
    const data = value as Record<string, unknown>
    if (
      data.version !== 1 ||
      typeof data.pgn !== 'string' ||
      !Number.isInteger(data.cursor)
    )
      throw new Error('Invalid saved match.')
    const imported = importChessPgn(data.pgn)
    const cursor = data.cursor as number
    if (cursor < 0 || cursor > imported.game.history.length)
      throw new Error('Invalid saved match position.')
    const session: GummyMatchSession = { ...imported, cursor }
    if (data.appearance !== undefined) {
      try {
        session.appearance = validateAppearance(data.appearance)
      } catch {
        return {
          session,
          error:
            'The game was restored, but its board settings were invalid. Default materials are shown.',
        }
      }
    }
    return { session }
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
      version: 1,
      pgn: exportChessPgn(session.game, session.headers),
      cursor: session.cursor,
      appearance: session.appearance
        ? validateAppearance(session.appearance)
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
  },
): GummyCinemaRecipe {
  const reason = gummyMatchCinemaReason(receipt)
  if (reason) throw new Error(reason)
  const attacker = receipt.before.pieces.find(
    (piece) => piece.id === receipt.pieceId,
  )!
  const palettes = gummyMatchPalettes(options.settings.palette)
  const title = `${attacker.role[0]!.toUpperCase()}${attacker.role.slice(1)} takes ${receipt.captured!.role}`
  const recipe = createGummyCinemaRecipe({
    id: `match-capture-${receipt.ply}`,
    title,
    fen: receipt.before.fen,
    from: receipt.from,
    to: receipt.to,
    boardTheme: options.theme,
    presetId: 'rockgummy',
    cameraStyle: 'arc',
    motion: { ...GUMMY_BOARD_EARLY_SHEAR_MOTION },
  })
  return parseGummyCinemaRecipe({
    ...recipe,
    material: createGummyPreset('Match material', options.settings).settings,
    scale: options.scale,
    quality: options.quality,
    attackerPalette: attacker.color === 'w' ? palettes[0] : palettes[1],
    victimPalette: receipt.captured!.color === 'w' ? palettes[0] : palettes[1],
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
