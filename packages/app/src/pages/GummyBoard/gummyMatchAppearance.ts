/** Shared, validated look and material snapshots for the live board and recorded captures. */
import { FRACTAL_CHESS_COLLECTIONS } from '@/flame/chess/fractalChessCollections'
import { parseNativeFractureMode } from '@/flame/chess/nativeFractureTypes'
import { validateGummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
import { createGummyPreset } from '../GummyBear/gummyPresets'
import type { GummyPresetSettings } from '../GummyBear/gummyPresets'
import type { GummyBoardQuality } from '@/components/GummyBoard/gummyBoardQuality'
import type { GummyBoardTheme } from '@/components/GummyBoard/gummyBoardThemes'
import type { FractalChessCollectionId } from '@/flame/chess/fractalChessCollections'
import type { NativeFractureMode } from '@/flame/chess/nativeFractureTypes'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

export type NativeChessCollectionSelection = {
  version: 1
  id: FractalChessCollectionId
  enclosure: 'pure' | 'glass'
}

export function validateNativeChessCollectionSelection(
  value: unknown,
): NativeChessCollectionSelection | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid native chess collection.')
  const data = value as Record<string, unknown>
  if (
    data.version !== 1 ||
    !FRACTAL_CHESS_COLLECTIONS.some(
      (collection) => collection.id === data.id,
    ) ||
    (data.enclosure !== 'pure' && data.enclosure !== 'glass') ||
    Object.keys(data).length !== 3 ||
    Object.keys(data).some(
      (key) => !['version', 'id', 'enclosure'].includes(key),
    )
  )
    throw new Error('Invalid native chess collection.')
  return {
    version: 1,
    id: data.id as FractalChessCollectionId,
    enclosure: data.enclosure,
  }
}

export type GummyMatchAppearance = {
  settings: GummyPresetSettings
  quality: GummyBoardQuality
  scale: number
  theme: GummyBoardTheme
  authoredPawn?: GummyAuthoredPawn
  nativeCollection?: NativeChessCollectionSelection
  nativeFracture?: NativeFractureMode
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

export function validateGummyMatchAppearance(
  value: unknown,
): GummyMatchAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid match appearance.')
  const appearance = value as Record<string, unknown>
  const authoredPawn = validateGummyAuthoredPawn(appearance.authoredPawn)
  const nativeCollection = validateNativeChessCollectionSelection(
    appearance.nativeCollection,
  )
  const nativeFracture = parseNativeFractureMode(appearance.nativeFracture)
  if (appearance.authoredPawn !== undefined && !authoredPawn)
    throw new Error('Invalid authored pawn snapshot.')
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
    ...(authoredPawn ? { authoredPawn } : {}),
    ...(nativeCollection ? { nativeCollection } : {}),
    ...(nativeFracture ? { nativeFracture } : {}),
  }
}
