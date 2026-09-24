/**
 * The editor canvas's framing beside chrome that floats over it, wired to the
 * canvas: the share of the canvas the floating tablet deck covers, the camera
 * shift that centres the flame in the rest (lib/canvasFraming.ts), the
 * attribute that tells captures which part is on show, and the export-image
 * hook cut to that part (./visibleCanvas.ts).
 *
 * Nothing is covered, and so nothing shifts or is cut, while an export sizes
 * the canvas itself: the canvas then renders the export's own frame, which
 * the deck has no part in. The shift reaches the cameras as a prop and goes
 * no further; this hook writes neither the flame nor its camera.
 */
import { createEffect, createMemo } from 'solid-js'
import { coveredFraction, framingShift, trailingCover, } from '@/lib/canvasFraming'
import { captureVisiblePart, COVERED_RIGHT_KEY } from './visibleCanvas'
import type { Accessor } from 'solid-js'
import type { ExportImageType } from '@/flame/exportImageType'
import type { ViewShift } from '@/lib/canvasFraming'
import type { ExportDimensions } from '@/utils/exportDimensions'

export interface ViewFramingOptions {
  /** The canvas box's width in CSS px; undefined until it is laid out. */
  width: Accessor<number | undefined>
  /** The workspace canvas, once it is mounted. */
  canvas: Accessor<HTMLCanvasElement | undefined>
  /** Set while an export renders at a size of its own. */
  exportDimensions: Accessor<ExportDimensions | undefined>
  /** The capture waiting for the next frame, if any. */
  onExportImage: Accessor<ExportImageType | undefined>
}

export interface ViewFraming {
  /** For the cameras' `viewShift`. */
  viewShift: Accessor<ViewShift>
  /** For the renderer's `onExportImage`: the capture, cut to what is on show. */
  exportImage: Accessor<ExportImageType | undefined>
}

export function useViewFraming(options: ViewFramingOptions): ViewFraming {
  const coveredRight = createMemo(() =>
    options.exportDimensions()
      ? 0
      : coveredFraction(trailingCover(), options.width() ?? 0),
  )
  const viewShift = createMemo(() => framingShift(coveredRight()))

  // Written only when it changes, and removed rather than set to 0, so a
  // canvas with nothing over it looks exactly as it did before there was
  // any framing.
  createEffect(() => {
    const canvas = options.canvas()
    if (!canvas) return
    const covered = coveredRight()
    if (covered > 0) canvas.dataset[COVERED_RIGHT_KEY] = String(covered)
    else delete canvas.dataset[COVERED_RIGHT_KEY]
  })

  const exportImage = createMemo(() => {
    const capture = options.onExportImage()
    return capture && captureVisiblePart(capture)
  })

  return { viewShift, exportImage }
}
