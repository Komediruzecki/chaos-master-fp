/** Versioned local board appearance, independent of the shared material preset library. */
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'

export const GUMMY_BOARD_APPEARANCE_KEY = 'gummy-board-appearance-v1'
export const GUMMY_BOARD_PALETTES = [
  ['marble', 'Marble'],
  ['candy', 'Candy'],
  ['lagoon', 'Lagoon'],
  ['blue', 'Blue'],
  ['amber', 'Amber'],
  ['berry', 'Berry'],
] as const
import type { GummyBoardQuality } from '@/components/GummyBoard/gummyBoardQuality'

export type { GummyBoardQuality } from '@/components/GummyBoard/gummyBoardQuality'
export type GummyBoardAppearance = {
  paletteOverrides: Partial<Record<number, GummyPalette>>
  pieceScale: number
  quality: GummyBoardQuality
}
export function defaultGummyBoardAppearance(): GummyBoardAppearance {
  return { paletteOverrides: {}, pieceScale: 0.9, quality: 'auto' }
}

function validate(value: unknown): GummyBoardAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid appearance')
  const record = value as Record<string, unknown>
  if (
    record.version !== 1 ||
    typeof record.pieceScale !== 'number' ||
    !Number.isFinite(record.pieceScale) ||
    record.pieceScale < 0.85 ||
    record.pieceScale > 1 ||
    !['auto', 'tablet', 'high'].includes(String(record.quality))
  )
    throw new Error('Invalid appearance')
  if (
    !record.paletteOverrides ||
    typeof record.paletteOverrides !== 'object' ||
    Array.isArray(record.paletteOverrides)
  )
    throw new Error('Invalid colors')
  const paletteOverrides: Partial<Record<number, GummyPalette>> = {}
  for (const [key, palette] of Object.entries(record.paletteOverrides)) {
    const id = Number(key)
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      id > 32 ||
      String(id) !== key ||
      !GUMMY_BOARD_PALETTES.some(([name]) => name === palette)
    )
      throw new Error('Invalid piece color')
    paletteOverrides[id] = palette as GummyPalette
  }
  return {
    paletteOverrides,
    pieceScale: record.pieceScale,
    quality: record.quality as GummyBoardQuality,
  }
}
export function loadGummyBoardAppearance(storage?: Pick<Storage, 'getItem'>): {
  appearance: GummyBoardAppearance
  error?: string
} {
  try {
    const json = (storage ?? globalThis.localStorage).getItem(
      GUMMY_BOARD_APPEARANCE_KEY,
    )
    if (!json) return { appearance: defaultGummyBoardAppearance() }
    if (json.length > 16_384) throw new Error('Appearance is too large')
    return { appearance: validate(JSON.parse(json) as unknown) }
  } catch {
    return {
      appearance: defaultGummyBoardAppearance(),
      error:
        'Saved board appearance could not be loaded. The defaults are shown.',
    }
  }
}
export function saveGummyBoardAppearance(
  appearance: GummyBoardAppearance,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const valid = validate({ version: 1, ...appearance })
  ;(storage ?? globalThis.localStorage).setItem(
    GUMMY_BOARD_APPEARANCE_KEY,
    JSON.stringify({ version: 1, ...valid }),
  )
}
