/**
 * Server-side stub for solid-js/store.
 * The server doesn't maintain reactive stores — all functions are no-ops or
 * identity transforms.
 */

export type SetStoreFunction<T extends object = Record<string, unknown>> = (
  v: Partial<T> | ((prev: T) => Partial<T>),
) => void

export type Store<T extends object = Record<string, unknown>> = T

export function createStore<T extends Record<string, unknown>>(
  init: T,
): [T, SetStoreFunction<T>] {
  return [init, (_v: Partial<T> | ((prev: T) => Partial<T>)) => {}]
}

export function unwrap<T>(v: T): T {
  return v
}

export function reconcile<T>(v: T): T {
  return v
}

export function produce<T>(fn: (state: T) => void): (state: T) => T {
  return (state: T) => {
    fn(state)
    return state
  }
}
