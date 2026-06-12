/**
 * Color map system for fractal flames.
 *
 * Re-exports all types and pure functions from renderer-core.
 * Adds localStorage-backed persistence for custom palettes (browser-only).
 */

import { generatePaletteId } from 'renderer-core/flame/colorMap'
import { safeGetItem, safeSetItem } from '@/utils/storage'
import type { Palette } from 'renderer-core/flame/colorMap'

export type {
  ColorMapEntry,
  ColorMap,
  PaletteEntry,
  Palette,
} from 'renderer-core/flame/colorMap'

export {
  paletteEntry,
  palette,
  paletteToColorMap,
  paletteToColorMap2,
  paletteToEntries,
  colorEntry,
  colorMap,
  applyColorMapToFlame,
  defaultColorMaps,
} from 'renderer-core/flame/colorMap'

/** Storage key for custom palettes */
const CUSTOM_PALETTES_KEY = 'chaos-master-custom-palettes'

/**
 * Load custom palettes from localStorage
 */
export function loadCustomPalettes(): Palette[] {
  try {
    const raw = safeGetItem(CUSTOM_PALETTES_KEY)
    if (raw === null || raw === '') return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is Palette =>
        typeof p === 'object' &&
        p !== null &&
        typeof p.id === 'string' &&
        Array.isArray(p.entries),
    )
  } catch {
    return []
  }
}

/**
 * Save custom palettes to localStorage
 */
export function saveCustomPalettes(palettes: Palette[]): void {
  safeSetItem(CUSTOM_PALETTES_KEY, JSON.stringify(palettes))
}

/**
 * Add a custom palette
 */
export function addCustomPalette(
  palette: Omit<Palette, 'id' | 'createdAt'>,
): Palette {
  const newPalette: Palette = {
    ...palette,
    id: generatePaletteId(),
    createdAt: Date.now(),
  }
  const existing = loadCustomPalettes()
  saveCustomPalettes([...existing, newPalette])
  return newPalette
}

/**
 * Delete a custom palette by ID
 */
export function deleteCustomPalette(id: string): void {
  const existing = loadCustomPalettes()
  saveCustomPalettes(existing.filter((p) => p.id !== id))
}

/**
 * Update a custom palette
 */
export function updateCustomPalette(
  id: string,
  updates: Partial<Omit<Palette, 'id' | 'createdAt'>>,
): Palette | null {
  const existing = loadCustomPalettes()
  const idx = existing.findIndex((p) => p.id === id)
  if (idx === -1) return null

  const updated: Palette = {
    ...existing[idx]!,
    ...updates,
  }
  existing[idx] = updated
  saveCustomPalettes(existing)
  return updated
}
