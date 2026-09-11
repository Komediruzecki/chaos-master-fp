/**
 * Server-side stub for @/utils/useContextSafe.
 * Throws a descriptive error if called — the server never uses SolidJS contexts.
 */

export function useContextSafe<T>(
  _context: { default: T | undefined; [key: symbol]: unknown },
  hookName: string,
  _providerComponentName: string,
): T {
  throw new Error(
    `Server-side stub: ${hookName} is not available in the render worker. ` +
      'This function is only used in browser SolidJS components.',
  )
}
