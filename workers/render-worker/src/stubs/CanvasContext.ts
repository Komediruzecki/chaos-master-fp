/**
 * Server-side stub for @/lib/CanvasContext.
 * The server has no canvas; these are no-ops or throw on use.
 */

export const CanvasContextProvider = (_props: Record<string, unknown>) =>
  undefined

export function useCanvas() {
  throw new Error(
    'Server-side stub: useCanvas() is not available in the render worker.',
  )
}
