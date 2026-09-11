/**
 * Server-side stub for @/utils/storage.
 * localStorage is not available in the render worker — these are no-ops.
 */

export function safeGetItem(_key: string): string | null {
  return null
}

export function safeSetItem(_key: string, _value: string): void {}

export function safeRemoveItem(_key: string): void {}
