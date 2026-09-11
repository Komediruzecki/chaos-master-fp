/**
 * Server-side stub for structurajs (structural sharing / diffing).
 * Not needed on the server — all functions are no-ops or identity.
 */

export function compress<T>(v: T): T {
  return v
}

export function decompress<T>(v: T): T {
  return v
}

export function applyPatchesMutatively<T>(_state: T, _patches: Patch[]): T {
  return _state
}

export function enableStandardPatches(): void {}

export function produceWithPatches<T>(
  state: T,
  _recipe: (draft: T) => void,
): [T, Patch[], Patch[]] {
  return [state, [], []]
}

export type Patch = {
  op: 'add' | 'remove' | 'replace'
  path: (string | number)[]
  value?: unknown
}

export default { compress, decompress }
