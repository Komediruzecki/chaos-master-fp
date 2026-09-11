/* eslint-disable @typescript-eslint/no-namespace, @typescript-eslint/no-redundant-type-constituents */
/**
 * Minimal solid-js stub for Deno server-side typegpu pipeline usage.
 * Only the exports referenced by imported client modules are provided.
 * All reactivity and component APIs are no-ops; the server doesn't render UI.
 */

// ── no-op reactive primitives ────────────────────────────────────────────────

export function createMemo<T>(fn: () => T): () => T {
  return fn
}

export function createEffect(_fn: () => void): void {}

export function createSignal<T>(value: T): [() => T, (v: T) => void] {
  return [() => value, (_v: T) => {}]
}

export function createContext<T>(defaultValue?: T) {
  const id = Symbol('context')
  return {
    id,
    default: defaultValue,
    Provider: (_props: Record<string, unknown>) => undefined,
  } as unknown as { id: symbol; default: T; Provider: () => void }
}

export function useContext<T>(context: {
  id: symbol
  default: T
}): T | undefined {
  return context.default
}

export function onCleanup(_fn: () => void) {}

export function batch(fn: () => void): void {
  fn()
}

export function on<T>(_deps: () => T, _fn: (v: T) => void): void {}

// ── component / JSX types ────────────────────────────────────────────────────

export type Accessor<T> = () => T
export type Setter<T> = (v: T | ((prev: T) => T)) => T
export type ParentProps<T = Record<string, unknown>> = T & {
  children?: unknown
}
export type Context<T = unknown> = {
  id: symbol
  default: T
  Provider: () => void
}

export type Component<P = Record<string, unknown>> = (props: P) => JSXElement

export type JSXElement = null | undefined | string | number | boolean | object

export namespace JSX {
  export type Element = JSXElement

  export interface IntrinsicElements {
    div: Record<string, unknown>
    span: Record<string, unknown>
    input: Record<string, unknown>
    button: Record<string, unknown>
    label: Record<string, unknown>
    select: Record<string, unknown>
    option: Record<string, unknown>
    textarea: Record<string, unknown>
    a: Record<string, unknown>
    img: Record<string, unknown>
    svg: Record<string, unknown>
    path: Record<string, unknown>
    circle: Record<string, unknown>
    line: Record<string, unknown>
    g: Record<string, unknown>
    canvas: Record<string, unknown>
    h1: Record<string, unknown>
    h2: Record<string, unknown>
    h3: Record<string, unknown>
    p: Record<string, unknown>
    ul: Record<string, unknown>
    li: Record<string, unknown>
    section: Record<string, unknown>
    header: Record<string, unknown>
    footer: Record<string, unknown>
    main: Record<string, unknown>
    nav: Record<string, unknown>
    form: Record<string, unknown>
    table: Record<string, unknown>
    tr: Record<string, unknown>
    td: Record<string, unknown>
    th: Record<string, unknown>
    thead: Record<string, unknown>
    tbody: Record<string, unknown>
  }
}

// ── control-flow components ──────────────────────────────────────────────────

export function Show<T>(_props: {
  when: T | undefined | null | false
  fallback?: unknown
  children: unknown | ((item: NonNullable<T>) => unknown)
}): null {
  return null
}
