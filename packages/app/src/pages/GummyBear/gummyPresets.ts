/** Complete, validated material presets that travel between gummy figures and stay on this device. */
import { GUMMY_PARTICLE_TUNING_RANGES } from '@/simulation/gummy/gummyParticleTuning'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { GummyParticleTuning } from '@/simulation/gummy/gummyParticleTuning'

export type GummyPresetSettings = {
  palette: GummyPalette
  particleMaterial: 'warm' | 'elastic'
  softness: number
  fragility: number
  tearing: boolean
  tuning: GummyParticleTuning
  grabRadius: number
  maxPull: number
  pinnedFeet: boolean
  caustics: boolean
}

export type GummyMaterialPreset = {
  format: 'gummy-material-preset'
  version: 1
  name: string
  settings: GummyPresetSettings
}

export const GUMMY_PRESET_STORAGE_KEY = 'gummy-material-presets-v1'
export const GUMMY_PRESET_NAME_LIMIT = 60
export const GUMMY_PRESET_LIMIT = 40
const PRESET_JSON_LIMIT = 16_384
const LIBRARY_JSON_LIMIT = PRESET_JSON_LIMIT * GUMMY_PRESET_LIMIT

function object(value: unknown, keys: string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`)
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  )
    throw new Error(`${label} has missing or unsupported fields.`)
  return record
}

function number(value: unknown, min: number, max: number, label: string) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be a number from ${min} to ${max}.`)
  return value
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean')
    throw new Error(`${label} must be true or false.`)
  return value
}

function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !choices.includes(value as T))
    throw new Error(`${label} is not supported.`)
  return value as T
}

export function gummyPresetName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a preset name.')
  const name = value.trim()
  if (
    !name ||
    name.length > GUMMY_PRESET_NAME_LIMIT ||
    /[\p{Cc}\p{Zl}\p{Zp}]/u.test(name)
  )
    throw new Error(
      `Use a preset name with 1 to ${GUMMY_PRESET_NAME_LIMIT} characters on one line.`,
    )
  return name
}

function validatePreset(value: unknown): GummyMaterialPreset {
  const preset = object(
    value,
    ['format', 'version', 'name', 'settings'],
    'Preset',
  )
  if (preset.format !== 'gummy-material-preset')
    throw new Error('This is not a gummy material preset.')
  if (preset.version !== 1)
    throw new Error('This preset version is not supported. Expected version 1.')
  const settings = object(
    preset.settings,
    [
      'palette',
      'particleMaterial',
      'softness',
      'fragility',
      'tearing',
      'tuning',
      'grabRadius',
      'maxPull',
      'pinnedFeet',
      'caustics',
    ],
    'Preset settings',
  )
  const tuning = object(
    settings.tuning,
    Object.keys(GUMMY_PARTICLE_TUNING_RANGES),
    'Fine tuning',
  )
  const tuningValue = (key: keyof GummyParticleTuning) => {
    const range = GUMMY_PARTICLE_TUNING_RANGES[key]
    return number(tuning[key], range.min, range.max, key)
  }
  return {
    format: 'gummy-material-preset',
    version: 1,
    name: gummyPresetName(preset.name),
    settings: {
      palette: choice(
        settings.palette,
        ['blue', 'amber', 'berry', 'candy', 'lagoon', 'marble'],
        'Palette',
      ),
      particleMaterial: choice(
        settings.particleMaterial,
        ['warm', 'elastic'],
        'Material',
      ),
      softness: number(settings.softness, 0, 1, 'Softness'),
      fragility: number(settings.fragility, 0, 1, 'Fragility'),
      tearing: boolean(settings.tearing, 'Tearing'),
      tuning: {
        grabStrength: tuningValue('grabStrength'),
        flow: tuningValue('flow'),
        gravity: tuningValue('gravity'),
        floorDrag: tuningValue('floorDrag'),
        viscosity: tuningValue('viscosity'),
      },
      grabRadius: number(settings.grabRadius, 0.08, 0.4, 'Grab radius'),
      maxPull: number(settings.maxPull, 0.2, 1.8, 'Maximum pull'),
      pinnedFeet: boolean(settings.pinnedFeet, 'Pin to floor'),
      caustics: boolean(settings.caustics, 'Caustics'),
    },
  }
}

export function createGummyPreset(
  name: string,
  settings: GummyPresetSettings,
): GummyMaterialPreset {
  return validatePreset({
    format: 'gummy-material-preset',
    version: 1,
    name,
    settings,
  })
}

function parseJson(json: string, limit: number): unknown {
  if (json.length > limit) throw new Error('This preset JSON is too large.')
  try {
    return JSON.parse(json) as unknown
  } catch {
    throw new Error('The preset JSON is incomplete or invalid.')
  }
}

export function parseGummyPreset(json: string): GummyMaterialPreset {
  return validatePreset(parseJson(json, PRESET_JSON_LIMIT))
}

export function serializeGummyPreset(preset: GummyMaterialPreset): string {
  return JSON.stringify(validatePreset(preset), null, 2)
}

function validateLibrary(value: unknown): GummyMaterialPreset[] {
  if (!Array.isArray(value) || value.length > GUMMY_PRESET_LIMIT)
    throw new Error(
      `Keep up to ${GUMMY_PRESET_LIMIT} saved presets on this device.`,
    )
  const presets = value.map(validatePreset)
  const names = new Set(
    presets.map((preset) => preset.name.toLocaleLowerCase()),
  )
  if (names.size !== presets.length)
    throw new Error(
      'A preset with that name already exists. Use Update selected or choose another name.',
    )
  return presets
}

export function loadGummyPresets(storage?: Pick<Storage, 'getItem'>): {
  presets: GummyMaterialPreset[]
  error?: string
} {
  try {
    const json = (storage ?? globalThis.localStorage).getItem(
      GUMMY_PRESET_STORAGE_KEY,
    )
    if (!json) return { presets: [] }
    const library = object(
      parseJson(json, LIBRARY_JSON_LIMIT),
      ['format', 'version', 'presets'],
      'Saved presets',
    )
    if (library.format !== 'gummy-material-presets' || library.version !== 1)
      throw new Error('The saved preset library version is not supported.')
    return { presets: validateLibrary(library.presets) }
  } catch (error) {
    return {
      presets: [],
      error: `Saved presets could not be loaded. ${error instanceof Error ? error.message : 'Device storage is unavailable.'} Copy current still works.`,
    }
  }
}

/** Validation completes before touching storage, including duplicate names and list bounds. */
export function saveGummyPresets(
  storage: Pick<Storage, 'setItem'> | undefined,
  presets: readonly GummyMaterialPreset[],
): void {
  const validated = validateLibrary(presets)
  ;(storage ?? globalThis.localStorage).setItem(
    GUMMY_PRESET_STORAGE_KEY,
    JSON.stringify({
      format: 'gummy-material-presets',
      version: 1,
      presets: validated,
    }),
  )
}
