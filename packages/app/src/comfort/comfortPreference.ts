// The comfort preset in use, remembered across sessions. Before the viewer
// chooses one it follows the system: calm when the system asks for reduced
// motion, standard otherwise.
import { createSignal } from 'solid-js'
import { safeGetItem, safeSetItem } from '@/utils/storage'
import { COMFORT_PRESETS } from './comfortPresets'
import type { Signal } from 'solid-js'
import type { ComfortPreset } from './comfortPresets'

export const COMFORT_PRESET_STORAGE_KEY = 'chaos-master-comfort-preset'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function isComfortPreset(value: unknown): value is ComfortPreset {
  return (
    typeof value === 'string' &&
    (COMFORT_PRESETS as readonly string[]).includes(value)
  )
}

/** The remembered choice, else the system's reduced-motion answer. */
function initialComfortPreset(): ComfortPreset {
  const stored = safeGetItem(COMFORT_PRESET_STORAGE_KEY)
  if (isComfortPreset(stored)) return stored
  const reduce = globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches
  return reduce ? 'calm' : 'standard'
}

// Created on first read, not at import, so importing this module touches
// neither storage nor the media query.
let preset: Signal<ComfortPreset> | undefined

function presetSignal(): Signal<ComfortPreset> {
  preset ??= createSignal(initialComfortPreset())
  return preset
}

/** The comfort preset every modulation is held to. Reactive. */
export function comfortPreset(): ComfortPreset {
  return presetSignal()[0]()
}

/** Chooses a preset and remembers it. */
export function setComfortPreset(next: ComfortPreset): void {
  presetSignal()[1](next)
  safeSetItem(COMFORT_PRESET_STORAGE_KEY, next)
}

/** Reads the remembered choice and the system setting again. */
export function reloadComfortPreset(): void {
  presetSignal()[1](initialComfortPreset())
}
