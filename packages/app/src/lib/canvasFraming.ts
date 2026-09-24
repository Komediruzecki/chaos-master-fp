/**
 * Framing the editor canvas around the chrome that floats over it: which part
 * of the canvas is on show, and the view-only shift that centres the flame in
 * that part.
 *
 * With the Glass panels setting on, chrome floats over the canvas's edges and
 * the canvas runs on under it, so the art glows through the glass
 * (docs/plans/glass-panels.md, phase 2 and decision d): the tablet inspector
 * deck over the trailing edge, and the desktop sidebar over the leading one.
 * The flame is framed in what they leave visible: the camera's position, the
 * world point the flame is centred on, sits in the middle of that part
 * instead of the middle of the canvas. The document's camera position keeps
 * its meaning, "the world point in the middle of what you see", whether the
 * setting is on or off, so a pan or a zoom writes to it exactly what it would
 * write without the chrome.
 *
 * The shift is VIEW-ONLY. It reaches the camera's matrices (Camera2D,
 * Camera3D) and nothing else: never the flame document or its history, never
 * an export, a thumbnail, Recents or a share link, and never the server
 * renderer. Whatever leaves the canvas as an image is cut to the visible part
 * first (components/CanvasViewport/visibleCanvas.ts), which is the picture the
 * setting-off canvas would have made: the same framing, the same size to the
 * pixel's rounding, and the same brightness, since the renderer normalises by
 * the canvas height alone, which a cut across the width keeps.
 *
 * Shifts are in clip units, where the canvas spans -1 to 1 on each axis, so
 * they need no pixel ratio. Chrome covering a fraction l of the width at the
 * leading edge and r at the trailing edge leaves the part from -1 + 2l to
 * 1 - 2r on show, whose middle is at l - r.
 */
import { createSignal } from 'solid-js'

/** Where the camera's centre sits, in clip units, relative to the canvas centre. */
export interface ViewShift {
  /** -1 is the canvas's left edge, 1 its right. */
  readonly x: number
  /** -1 is the canvas's bottom edge, 1 its top. */
  readonly y: number
}

export const NO_SHIFT: ViewShift = Object.freeze({ x: 0, y: 0 })

/** The shares of the canvas's width that chrome covers, 0 to 1 at each edge. */
export interface Covered {
  /** At the leading (left) edge: the desktop sidebar. */
  readonly left: number
  /** At the trailing (right) edge: the tablet deck. */
  readonly right: number
}

export const NOT_COVERED: Covered = Object.freeze({ left: 0, right: 0 })

/**
 * The most of the width chrome may cover, both edges together, before
 * framing gives up widening the shift. The deck is at most 480 px of a canvas
 * at least 820 px wide (the 900 px deck threshold less the 80 px rail), a
 * fraction of 0.59. The desktop sidebar is a column beside the canvas from
 * 769 px, where its 18rem floor, less the 0.4rem the canvas already runs
 * under it, covers 0.37. The two are never on one layout together, so this
 * only catches nonsense.
 */
export const MAX_COVERED_FRACTION = 0.9

function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0
  return Math.min(MAX_COVERED_FRACTION, fraction)
}

/**
 * Both shares made usable: each at least 0, and together at most
 * MAX_COVERED_FRACTION, the two scaled down alike when they would cover more.
 */
function clampCovered(covered: Covered): Covered {
  const left = clampFraction(covered.left)
  const right = clampFraction(covered.right)
  const sum = left + right
  if (sum === 0) return NOT_COVERED
  if (sum <= MAX_COVERED_FRACTION) return { left, right }
  const scale = MAX_COVERED_FRACTION / sum
  return { left: left * scale, right: right * scale }
}

/**
 * The share of the canvas width that chrome covers at one edge: `coveredPx`
 * CSS px of a canvas `widthPx` CSS px wide. 0 when either is not a usable
 * measure, as before the first layout.
 */
export function coveredFraction(coveredPx: number, widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 0
  return clampFraction(coveredPx / widthPx)
}

/**
 * The shift that puts the camera's centre in the middle of the uncovered
 * part: l - r, the middle of the part from -1 + 2l to 1 - 2r.
 */
export function framingShift(covered: Covered): ViewShift {
  const { left, right } = clampCovered(covered)
  const x = left - right
  return x === 0 ? NO_SHIFT : { x, y: 0 }
}

/** A rectangle in an image's own pixels. */
export interface PixelRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The uncovered part of a `width` x `height` image of the canvas, in that
 * image's pixels: the full height, from the leading cover's edge, and the
 * width less both covered shares, each rounded to a whole pixel.
 */
export function visibleRegion(
  width: number,
  height: number,
  covered: Covered,
): PixelRegion {
  const { left, right } = clampCovered(covered)
  const x = Math.max(0, Math.min(width - 1, Math.round(width * left)))
  const visible = Math.round(width * (1 - left - right))
  return {
    x,
    y: 0,
    width: Math.min(width - x, Math.max(1, visible)),
    height,
  }
}

/** Width over height of the uncovered part of a canvas `width` x `height`. */
export function visibleAspect(
  width: number,
  height: number,
  covered: Covered,
): number {
  if (!(height > 0)) return 1
  const { left, right } = clampCovered(covered)
  return (width * (1 - left - right)) / height
}

/**
 * Applies `shift` after a 4x4 column-major clip transform, in place, and
 * returns it: every point it projects then lands `shift` further along in
 * normalised device coordinates. Clip x is divided by w afterwards, so the
 * shift is scaled by w here (x' = x + shift.x * w), which moves the vanishing
 * point with the rest of the picture: an off-axis projection, not a slide of
 * the scene. Written in place because the camera's matrix is a typed GPU
 * value it has just made for the frame.
 */
export function shiftClipTransform<T extends { [index: number]: number }>(
  matrix: T,
  shift: ViewShift,
): T {
  if (shift.x === 0 && shift.y === 0) return matrix
  for (let column = 0; column < 4; column++) {
    const w = matrix[column * 4 + 3]!
    matrix[column * 4] = matrix[column * 4]! + shift.x * w
    matrix[column * 4 + 1] = matrix[column * 4 + 1]! + shift.y * w
  }
  return matrix
}

const [trailingCover, setTrailingCover] = createSignal(0)

/**
 * CSS px of the editor canvas's trailing edge that floating chrome covers
 * right now: the tablet inspector deck's width while it floats over the
 * canvas and is open (TabletInspectorDeck.tsx), 0 otherwise. The deck is the
 * only writer, and writes 0 when it closes or unmounts; CanvasViewport turns
 * it into the camera's shift.
 */
export { trailingCover, setTrailingCover }

const [leadingCover, setLeadingCover] = createSignal(0)

/**
 * CSS px of the editor canvas's leading edge that floating chrome covers
 * right now: the desktop sidebar's, while it floats over the canvas as glass
 * (WorkspaceSidebar/useSidebarGlass.ts), 0 otherwise. The sidebar is the only
 * writer, and writes 0 when it is hidden or unmounted, with the Glass panels
 * setting off, and in the light theme. It counts from where the setting-off
 * canvas begins, 0.4rem inside the sidebar's trailing edge, so the part on
 * show is the setting-off canvas's box exactly. While it is above 0 the
 * canvas box spans the sidebar's column too (CanvasViewport.tsx), and
 * CanvasViewport turns it into the camera's shift.
 */
export { leadingCover, setLeadingCover }

const [deckResizing, setDeckResizing] = createSignal(false)

/**
 * Whether the tablet inspector deck's divider is being dragged and has moved
 * (TabletInspectorDeck.tsx). Every step of the drag resizes the canvas beside
 * the deck, or reframes the one under it while it floats, so the canvas
 * presents every frame of it, which the glass busy switch reads
 * (hooks/useWorkspaceGlassBusy.ts). The deck is the only writer.
 */
export { deckResizing, setDeckResizing }
