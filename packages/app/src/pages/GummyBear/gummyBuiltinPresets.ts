/** Ready-made gummy comparisons share the same grip, lighting and floor response. */
import { createGummyPreset } from './gummyPresets'
import type { GummyMaterialPreset, GummyPresetSettings } from './gummyPresets'

type BuiltinGummyPreset = {
  id: string
  label: string
  description: string
  preset: GummyMaterialPreset
}

function materialPreset(
  name: string,
  softness: number,
  fragility: number,
  flow: number,
  viscosity: number,
): GummyMaterialPreset {
  const settings: GummyPresetSettings = {
    palette: 'marble',
    particleMaterial: 'warm',
    softness,
    fragility,
    tearing: true,
    tuning: {
      grabStrength: 0.65,
      flow,
      gravity: 1,
      floorDrag: 8.5,
      viscosity,
    },
    grabRadius: 0.26,
    maxPull: 0.6,
    pinnedFeet: true,
    caustics: true,
  }
  return createGummyPreset(name, settings)
}

// Warm softness lowers shear stiffness; flow increases shape relaxation, while
// fragility lowers the damage threshold. Viscosity damps motion within the jelly.
export const GUMMY_BUILTIN_PRESETS: readonly BuiltinGummyPreset[] = [
  {
    id: 'low',
    label: 'Low: firm',
    description: 'More shape memory, slower flow and stronger damping.',
    preset: materialPreset('Low: firm', 0.25, 0.25, 0.15, 0.85),
  },
  {
    id: 'mid',
    label: 'Mid: soft',
    description: 'Moderate shape memory, flow and damping.',
    preset: materialPreset('Mid: soft', 0.5, 0.5, 0.5, 0.7),
  },
  {
    id: 'high',
    label: 'High: mushy',
    description: 'Faster flow, earlier yielding and less damping.',
    preset: materialPreset('High: mushy', 0.85, 0.9, 1, 0.25),
  },
  {
    id: 'rockgummy',
    label: 'RockGummy',
    description: 'Your settings: 65% softness and 70% fragility.',
    preset: materialPreset('RockGummy', 0.65, 0.7, 1, 0.61),
  },
]
