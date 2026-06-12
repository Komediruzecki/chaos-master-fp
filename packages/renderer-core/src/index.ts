/**
 * renderer-core: Shared WebGPU IFS fractal flame renderer.
 * Pure WGSL pipeline, runtime-agnostic (browser + Deno).
 */

// Selective re-exports to avoid name conflicts (both colorMap and colors define ColorMap/defaultColorMaps)
export * from './flame/colors'
export {
  paletteEntry,
  palette,
  paletteToColorMap,
  paletteToColorMap2,
  colorEntry,
  colorMap,
  paletteToEntries,
  applyColorMapToFlame,
  generatePaletteId,
} from './flame/colorMap'
export type { ColorMapEntry, PaletteEntry, Palette } from './flame/colorMap'

export * from './flame/palettes'
export * from './flame/randomize'
export * from './flame/flam3PaletteParser'
export * from './flame/variations'
export * from './flame/variations/utils'
