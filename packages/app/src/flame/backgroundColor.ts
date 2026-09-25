/**
 * The colour a flame's canvas is cleared to, the ground its art sits on: the
 * flame's own background colour when it names one, otherwise black for light
 * drawing and white for paint. Flam3 clears to it, and the canvas viewport
 * paints it under the canvas (CanvasViewport.tsx, --canvas-ground), where the
 * rail's sheet uncovers a strip of the canvas box by moving the canvas up.
 */
import { backgroundColorDefault, backgroundColorDefaultWhite, } from './schema/flameSchema'
import type { FlameDescriptor } from './schema/flameSchema'

export type Rgb = readonly [number, number, number]

export function flameBackgroundColor(
  renderSettings: FlameDescriptor['renderSettings'],
): Rgb {
  const chosen = renderSettings.backgroundColor
  // A colour the user chose is respected as it is, with no swap for paint.
  if (chosen !== undefined) return chosen
  return renderSettings.drawMode !== 'light'
    ? backgroundColorDefaultWhite
    : backgroundColorDefault
}

/** `rgb`, channels from 0 to 1, as a CSS colour. */
export function cssRgb(rgb: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
  return `rgb(${channel(rgb[0])} ${channel(rgb[1])} ${channel(rgb[2])})`
}
