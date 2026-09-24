/**
 * The part of the workspace canvas that is on show, for everything that takes
 * an image off it or points at it.
 *
 * With the Glass panels setting on, the canvas runs on under the chrome that
 * floats over its edges - the tablet deck at the trailing edge, the desktop
 * sidebar at the leading one - and the camera frames the flame in the part
 * they leave visible (lib/canvasFraming.ts). An image of the whole canvas
 * would carry that framing out of the editor: the flame off centre, beside a
 * strip nobody saw. So every image that leaves the canvas is cut to the
 * visible part first, which makes it the image the setting-off canvas would
 * have made:
 *
 * - the export-image hook (the flash export, the share link's preview, the
 *   Discord post) is handed the cut by `captureVisiblePart`;
 * - the randomizer history's thumbnail is drawn by `drawVisibleCanvas`;
 * - the export dialog's "match the viewport" aspect is `visibleCanvasAspect`.
 *
 * And the tour and the replay spotlight, which light the canvas up, take its
 * box from `visibleClientRect`, so neither lights a strip under the chrome.
 *
 * The canvas says how much of it is covered at each edge in
 * `data-covered-left` and `data-covered-right`, which CanvasViewport keeps
 * equal to the shift its camera draws with, and removes whenever nothing is
 * covered there, including while an export sizes the canvas itself. No
 * attribute means that edge of the canvas is in the picture.
 */
import { NOT_COVERED, visibleAspect, visibleRegion } from '@/lib/canvasFraming'
import type { ExportImageType } from '@/flame/exportImageType'
import type { Covered } from '@/lib/canvasFraming'

/** The attributes' names as `dataset` spells them. */
export const COVERED_LEFT_KEY = 'coveredLeft'
export const COVERED_RIGHT_KEY = 'coveredRight'

/**
 * The same two attributes as the DOM spells them, for a selector or a
 * MutationObserver's filter (SessionRecorder/ReplaySpotlight.tsx): chrome
 * opening or closing over the canvas moves no box, only these change.
 * visibleCanvas.test.ts holds the two spellings together.
 */
export const COVERED_ATTRIBUTES: readonly string[] = [
  'data-covered-left',
  'data-covered-right',
]

const COVERED_CANVAS = COVERED_ATTRIBUTES.map((name) => `canvas[${name}]`).join(
  ', ',
)

/** One edge's covered share of `canvas`'s width, from its attribute; 0 without one. */
function shareOf(canvas: HTMLCanvasElement, key: string): number {
  const raw = canvas.dataset[key]
  if (raw === undefined) return 0
  const fraction = Number(raw)
  return Number.isFinite(fraction) ? fraction : 0
}

/** The covered shares of `canvas`'s width, from its attributes. */
export function coveredOf(canvas: HTMLCanvasElement): Covered {
  const left = shareOf(canvas, COVERED_LEFT_KEY)
  const right = shareOf(canvas, COVERED_RIGHT_KEY)
  return left === 0 && right === 0 ? NOT_COVERED : { left, right }
}

const isCovered = (covered: Covered) => covered.left > 0 || covered.right > 0

/**
 * `[sx, sy, sw, sh]` for `drawImage`: the visible part of an image of
 * `canvas`, in that image's pixels. The image is the canvas itself unless
 * one is given, such as a PNG decoded from it.
 */
export function visibleCanvasRect(
  canvas: HTMLCanvasElement,
  image: { readonly width: number; readonly height: number } = canvas,
): [number, number, number, number] {
  const region = visibleRegion(image.width, image.height, coveredOf(canvas))
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
    coveredOf(canvas),
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
    const covered = coveredOf(canvas)
    if (!isCovered(covered)) {
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

/**
 * The on-show part of `element`'s box, in client px. That is the whole box,
 * unless `element` is the workspace canvas, or holds it, while chrome covers
 * part of the canvas: then the box starts where the leading cover ends and
 * stops where the trailing one begins.
 */
export function visibleClientRect(element: Element): DOMRect {
  const box = element.getBoundingClientRect()
  const canvas =
    element instanceof HTMLCanvasElement
      ? element
      : element.querySelector<HTMLCanvasElement>(COVERED_CANVAS)
  const covered = canvas ? coveredOf(canvas) : NOT_COVERED
  if (!canvas || !isCovered(covered)) return box
  const canvasBox = canvas === element ? box : canvas.getBoundingClientRect()
  const visibleLeft = canvasBox.left + canvasBox.width * covered.left
  const visibleRight = canvasBox.left + canvasBox.width * (1 - covered.right)
  const clamp = (x: number) => Math.max(box.left, Math.min(box.right, x))
  const left = clamp(visibleLeft)
  const right = Math.max(left, clamp(visibleRight))
  return new DOMRect(left, box.top, right - left, box.height)
}
