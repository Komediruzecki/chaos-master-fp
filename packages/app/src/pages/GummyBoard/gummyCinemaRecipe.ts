/** Portable shot recipes keep position, camera and material together without changing saved gummy presets. */
import { GUMMY_BOARD_ORIGINAL_MOTION, GUMMY_BOARD_SHOTS, resolveGummyBoardShot, resolveGummyBoardShotMotion, } from '@/components/GummyBoard/gummyBoardShots'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
import { createGummyPreset } from '../GummyBear/gummyPresets'
import { GUMMY_BOARD_PALETTES } from './gummyBoardAppearance'
import type { GummyPresetSettings } from '../GummyBear/gummyPresets'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { GummyBoardQuality } from '@/components/GummyBoard/gummyBoardQuality'
import type { GummyBoardShot, GummyBoardShotMotion, } from '@/components/GummyBoard/gummyBoardShots'

export type GummyCinemaRecipe = {
  format: 'gummy-cinema-shot'
  version: 2
  shot: GummyBoardShot & { motion: GummyBoardShotMotion }
  material: GummyPresetSettings
  scale: number
  quality: GummyBoardQuality
  artStyle: 'classic' | 'sculpted'
  attackerPalette: GummyPalette
  victimPalette: GummyPalette
}

export function createGummyCinemaRecipe(
  shot = GUMMY_BOARD_SHOTS[0]!,
): GummyCinemaRecipe {
  const preset =
    GUMMY_BUILTIN_PRESETS.find((p) => p.id === shot.presetId) ??
    GUMMY_BUILTIN_PRESETS[0]!
  return {
    format: 'gummy-cinema-shot',
    version: 2,
    shot: { ...shot, motion: resolveGummyBoardShotMotion(shot.motion) },
    material: createGummyPreset(preset.preset.name, preset.preset.settings)
      .settings,
    scale: 0.9,
    quality: 'auto',
    artStyle: 'sculpted',
    attackerPalette: shot.id === 'pawn-knight' ? 'amber' : 'lagoon',
    victimPalette: shot.id === 'pawn-knight' ? 'blue' : 'berry',
  }
}

export function parseGummyCinemaRecipe(value: unknown): GummyCinemaRecipe {
  const raw: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!raw || typeof raw !== 'object')
    throw new Error('Paste a shot recipe object.')
  const r = raw as Record<string, unknown>
  if (
    r.format !== 'gummy-cinema-shot' ||
    (r.version !== 1 && r.version !== 2) ||
    !r.shot ||
    typeof r.shot !== 'object' ||
    Array.isArray(r.shot)
  )
    throw new Error('Expected a version 1 or 2 gummy cinema shot.')
  const s = r.shot as Record<string, unknown>
  if (r.version === 1 && s.motion !== undefined)
    throw new Error('Use a version 2 recipe for shear settings.')
  if (r.version === 2 && s.motion === undefined)
    throw new Error('A version 2 recipe needs explicit shot motion.')
  const motion = resolveGummyBoardShotMotion(
    r.version === 1 ? GUMMY_BOARD_ORIGINAL_MOTION : s.motion,
  )
  for (const key of ['id', 'title', 'fen', 'from', 'to', 'presetId'])
    if (typeof s[key] !== 'string' || s[key].length > 200)
      throw new Error(`Invalid shot ${key}.`)
  if (!['classic', 'glass', 'lava'].includes(s.boardTheme as string))
    throw new Error('Choose Classic, Glass or Lava for the board.')
  if (!['arc', 'diagonal', 'hero'].includes(s.cameraStyle as string))
    throw new Error('Choose an arc, diagonal or hero camera.')
  if (!['auto', 'tablet', 'high'].includes(r.quality as string))
    throw new Error('Choose Auto, Tablet or High quality.')
  if (
    r.artStyle !== undefined &&
    !['classic', 'sculpted'].includes(r.artStyle as string)
  )
    throw new Error('Choose classic or sculpted pieces.')
  for (const key of ['attackerPalette', 'victimPalette'])
    if (
      r[key] !== undefined &&
      !GUMMY_BOARD_PALETTES.some((p) => p[0] === r[key])
    )
      throw new Error('Choose an available candy palette.')
  if (
    typeof r.scale !== 'number' ||
    !Number.isFinite(r.scale) ||
    r.scale < 0.85 ||
    r.scale > 1
  )
    throw new Error('Piece size must be between 85% and 100%.')
  const shot = { ...s, motion } as GummyBoardShot & {
    motion: GummyBoardShotMotion
  }
  resolveGummyBoardShot(shot)
  const material = createGummyPreset(
    'Shot material',
    r.material as GummyPresetSettings,
  ).settings
  return {
    format: 'gummy-cinema-shot',
    version: 2,
    shot: { ...shot },
    material,
    scale: r.scale,
    quality: r.quality as GummyBoardQuality,
    artStyle: r.artStyle === 'classic' ? 'classic' : 'sculpted',
    attackerPalette: (r.attackerPalette ?? 'amber') as GummyPalette,
    victimPalette: (r.victimPalette ?? 'blue') as GummyPalette,
  }
}
