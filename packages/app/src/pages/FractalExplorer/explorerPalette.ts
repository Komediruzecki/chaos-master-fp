/**
 * A palette as the explorer's colour pass reads it: a fixed-size cyclic
 * table of OkLab (a, b) pairs. The app's palettes are ramps, not loops, so
 * the table runs the ramp forward and then back; the colour never jumps
 * where the iteration count wraps around the cycle.
 */
import { paletteToColorMap } from '@/flame/colorMap'
import type { Palette } from '@/flame/colorMap'

export function paletteLut(
  palette: Palette,
  size: number,
): Float32Array<ArrayBuffer> {
  const half = size / 2
  const ramp = paletteToColorMap(palette, half + 1)
  const lut = new Float32Array(size * 2)
  for (let i = 0; i < size; i += 1) {
    const entry = ramp[i <= half ? i : size - i] ?? ramp[0]!
    lut[2 * i] = entry.a
    lut[2 * i + 1] = entry.b
  }
  return lut
}
