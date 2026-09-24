/**
 * The editor canvas's framing beside chrome that floats over it, wired to the
 * canvas: the shares of the canvas the floating tablet deck and the glass
 * desktop sidebar cover, the camera shift that centres the flame in the rest
 * (lib/canvasFraming.ts), the attributes that tell captures which part is on
 * show, and the export-image hook cut to that part (./visibleCanvas.ts).
 *
 * Nothing is covered, and so nothing shifts or is cut, while an export sizes
 * the canvas itself: the canvas then renders the export's own frame, which
 * the chrome has no part in. The shift reaches the cameras as a prop and goes
 * no further; this hook writes neither the flame nor its camera.
 */
import { createEffect, createMemo } from 'solid-js'
import { coveredFraction, framingShift, leadingCover, NOT_COVERED, trailingCover, } from '@/lib/canvasFraming'
import { captureVisiblePart, COVERED_LEFT_KEY, COVERED_RIGHT_KEY, } from './visibleCanvas'
import type { Accessor } from 'solid-js'
import type { ExportImageType } from '@/flame/exportImageType'
import type { Covered, ViewShift } from '@/lib/canvasFraming'
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
  /**
   * The shares of the canvas's width the floating chrome covers at each
   * edge, 0 to 1: NOT_COVERED with nothing over it, and while an export
   * sizes the canvas.
   */
  covered: Accessor<Covered>
  /** For the cameras' `viewShift`. */
  viewShift: Accessor<ViewShift>
  /** For the renderer's `onExportImage`: the capture, cut to what is on show. */
  exportImage: Accessor<ExportImageType | undefined>
}

const sameCovered = (a: Covered, b: Covered) =>
  a.left === b.left && a.right === b.right

export function useViewFraming(options: ViewFramingOptions): ViewFraming {
  const covered = createMemo<Covered>(
    () => {
      if (options.exportDimensions()) return NOT_COVERED
      const width = options.width() ?? 0
      const left = coveredFraction(leadingCover(), width)
      const right = coveredFraction(trailingCover(), width)
      return left === 0 && right === 0 ? NOT_COVERED : { left, right }
    },
    NOT_COVERED,
    { equals: sameCovered },
  )
  const viewShift = createMemo(() => framingShift(covered()))

  // Written only when they change, and removed rather than set to 0, so a
  // canvas with nothing over it looks exactly as it did before there was
  // any framing.
  createEffect(() => {
    const canvas = options.canvas()
    if (!canvas) return
    const { left, right } = covered()
    if (left > 0) canvas.dataset[COVERED_LEFT_KEY] = String(left)
    else delete canvas.dataset[COVERED_LEFT_KEY]
    if (right > 0) canvas.dataset[COVERED_RIGHT_KEY] = String(right)
    else delete canvas.dataset[COVERED_RIGHT_KEY]
  })

  const exportImage = createMemo(() => {
    const capture = options.onExportImage()
    return capture && captureVisiblePart(capture)
  })

  return { covered, viewShift, exportImage }
}
