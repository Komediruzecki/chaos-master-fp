/**
 * The part of the workspace canvas that is on show, for everything that takes
 * an image off it.
 *
 * With the Glass panels setting on, the canvas runs on under the floating
 * tablet deck and the camera frames the flame in the part the deck leaves
 * visible (lib/canvasFraming.ts). An image of the whole canvas would carry
 * that framing out of the editor: the flame off centre, beside a strip nobody
 * saw. So every image that leaves the canvas is cut to the visible part
 * first, which makes it the image the setting-off canvas would have made:
 *
 * - the export-image hook (the flash export, the share link's preview, the
 *   Discord post) is handed the cut by `captureVisiblePart`;
 * - the randomizer history's thumbnail is drawn by `drawVisibleCanvas`;
 * - the export dialog's "match the viewport" aspect is `visibleCanvasAspect`.
 *
 * The canvas says how much of it is covered in `data-covered-right`, which
 * CanvasViewport keeps equal to the shift its camera draws with, and removes
 * whenever nothing is covered, including while an export sizes the canvas
 * itself. No attribute means the whole canvas is the picture.
 */
import { visibleAspect, visibleRegion } from '@/lib/canvasFraming'
import type { ExportImageType } from '@/flame/exportImageType'

/** The attribute's name as `dataset` spells it. */
export const COVERED_RIGHT_KEY = 'coveredRight'

/** The covered share of `canvas`'s width, from its attribute; 0 without one. */
export function coveredRightOf(canvas: HTMLCanvasElement): number {
  const raw = canvas.dataset[COVERED_RIGHT_KEY]
  if (raw === undefined) return 0
  const fraction = Number(raw)
  return Number.isFinite(fraction) ? fraction : 0
}

/**
 * `[sx, sy, sw, sh]` for `drawImage`: the visible part of an image of
 * `canvas`, in that image's pixels. The image is the canvas itself unless
 * one is given, such as a PNG decoded from it.
 */
export function visibleCanvasRect(
  canvas: HTMLCanvasElement,
  image: { readonly width: number; readonly height: number } = canvas,
): [number, number, number, number] {
  const region = visibleRegion(
    image.width,
    image.height,
    coveredRightOf(canvas),
  )
  return [region.x, region.y, region.width, region.height]
}

/**
 * Draws the visible part of `image`, an image of `canvas` such as a PNG
 * decoded from it, into `context` at the origin, `width` x `height`.
 */
export function drawVisibleCanvas(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement | HTMLCanvasElement,
  width: number,
  height: number,
): void {
  const [sx, sy, sw, sh] = visibleCanvasRect(canvas, image)
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height)
}

/** Width over height of what the canvas shows, in CSS px. */
export function visibleCanvasAspect(canvas: HTMLCanvasElement): number {
  return visibleAspect(
    canvas.clientWidth,
    canvas.clientHeight,
    coveredRightOf(canvas),
  )
}

/**
 * `capture`, handed the visible part of the canvas rather than all of it.
 *
 * Nothing covered, it gets the live canvas itself, untouched. Otherwise it
 * gets a 2D canvas holding a copy of the visible part, made in the call, so
 * the copy is the frame the renderer hands over and not a later one. The
 * copy is reused from frame to frame, which is safe for every capture there
 * is, since each takes its `toBlob` inside the call and `toBlob` snapshots at
 * once. Where no 2D context can be had, the frame is skipped rather than
 * handed over whole: a capture that times out says so, and a wrongly framed
 * image would not.
 */
export function captureVisiblePart(capture: ExportImageType): ExportImageType {
  let copy: HTMLCanvasElement | undefined
  return (canvas, info) => {
    const covered = coveredRightOf(canvas)
    if (covered <= 0) {
      capture(canvas, info)
      return
    }
    const region = visibleRegion(canvas.width, canvas.height, covered)
    copy ??= document.createElement('canvas')
    if (copy.width !== region.width) copy.width = region.width
    if (copy.height !== region.height) copy.height = region.height
    const context = copy.getContext('2d')
    if (!context) return
    context.globalCompositeOperation = 'copy'
    context.drawImage(
      canvas,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    )
    capture(copy, info)
  }
}
