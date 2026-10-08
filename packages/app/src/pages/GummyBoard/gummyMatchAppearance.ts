/** Shared, validated look and material snapshots for the live board and recorded captures. */
import { validateGummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
import { createGummyPreset } from '../GummyBear/gummyPresets'
import type { GummyPresetSettings } from '../GummyBear/gummyPresets'
import type { GummyBoardQuality } from '@/components/GummyBoard/gummyBoardQuality'
import type { GummyBoardTheme } from '@/components/GummyBoard/gummyBoardThemes'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

export type GummyMatchAppearance = {
  settings: GummyPresetSettings
  quality: GummyBoardQuality
  scale: number
  theme: GummyBoardTheme
  authoredPawn?: GummyAuthoredPawn
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
  }
}
