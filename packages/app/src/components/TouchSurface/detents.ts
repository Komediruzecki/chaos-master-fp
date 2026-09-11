/**
 * The rail's three resting heights and how a drag settles between them.
 * Pure, so the rail's gesture handling is testable without a DOM.
 * Heights are CSS px measured from the bottom of the viewport; the peek
 * height includes the bottom safe area.
 */
export type Detent = 'peek' | 'medium' | 'large'

export const DETENTS: readonly Detent[] = ['peek', 'medium', 'large']
export const PEEK_HEIGHT = 96
export const MEDIUM_FRACTION = 0.44
export const LARGE_FRACTION = 0.88
/** px per ms; above this a release goes one detent in the direction of travel. */
export const FLICK_VELOCITY = 0.5

export interface DetentHeights {
  readonly peek: number
  readonly medium: number
  readonly large: number
}

export function detentHeights(viewportHeight: number): DetentHeights {
  return {
    peek: PEEK_HEIGHT,
    medium: Math.round(viewportHeight * MEDIUM_FRACTION),
    large: Math.round(viewportHeight * LARGE_FRACTION),
  }
}

export function heightOf(detent: Detent, heights: DetentHeights): number {
  return heights[detent]
}

/** No rubber band past large, and never below peek: the rail is never gone. */
export function clampSheetHeight(
  height: number,
  heights: DetentHeights,
): number {
  return Math.min(heights.large, Math.max(heights.peek, height))
}

export function nearestDetent(height: number, heights: DetentHeights): Detent {
  let best: Detent = 'peek'
  let bestDistance = Infinity
  for (const detent of DETENTS) {
    const distance = Math.abs(heights[detent] - height)
    if (distance < bestDistance) {
      best = detent
      bestDistance = distance
    }
  }
  return best
}

/**
 * Where a released sheet comes to rest. A flick goes to the next detent in
 * the direction of travel (the smallest detent above the current height, or
 * the largest below it); anything slower settles at the nearest.
 */
export function settleDetent(
  height: number,
  velocity: number,
  heights: DetentHeights,
): Detent {
  if (velocity >= FLICK_VELOCITY) {
    return DETENTS.find((detent) => heights[detent] > height) ?? 'large'
  }
  if (velocity <= -FLICK_VELOCITY) {
    const below = DETENTS.filter((detent) => heights[detent] < height)
    return below.at(-1) ?? 'peek'
  }
  return nearestDetent(height, heights)
}
