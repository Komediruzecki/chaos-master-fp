/**
 * Parser for Flam3 palette XML files.
 *
 * Re-exports types and most functions from renderer-core.
 * Keeps browser-specific File API import function here.
 */

import { flam3PaletteToPalette, parseFlam3Palettes, } from 'renderer-core/flame/flam3PaletteParser'
import type { Palette } from 'renderer-core/flame/colorMap'
import type { Flam3PaletteData } from 'renderer-core/flame/flam3PaletteParser'

export type { Flam3PaletteData } from 'renderer-core/flame/flam3PaletteParser'

export {
  PREFILTER_WHITE,
  flam3CalcAlpha,
  parseFlam3Palettes,
  flam3PaletteToPalette,
  loadOfficialPalettes,
} from 'renderer-core/flame/flam3PaletteParser'

/**
 * Import palettes from a flam3 XML file (user-imported).
 */
export async function importFlam3Palettes(file: File): Promise<Palette[]> {
  const content = await file.text()
  const palettes = parseFlam3Palettes(content)
  const extended = palettes.filter((p: Flam3PaletteData) => p.number < 0)
  return extended.map(flam3PaletteToPalette)
}
