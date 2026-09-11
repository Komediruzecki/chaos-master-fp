/**
 * Server-side stub for solid-js/jsx-runtime.
 * Provides no-op JSX factory functions so that .tsx files can be type-checked.
 */

export function jsx(
  _tag: unknown,
  _props: Record<string, unknown> | null,
): unknown {
  return null
}

export function jsxs(
  _tag: unknown,
  _props: Record<string, unknown> | null,
): unknown {
  return null
}

export function jsxDEV(
  _tag: unknown,
  _props: Record<string, unknown> | null,
): unknown {
  return null
}

export const Fragment = (_props: { children?: unknown }) => null
