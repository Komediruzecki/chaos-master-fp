/**
 * Server-side stub for @/utils/clone.
 * On the server there are no SolidJS reactivity proxies to unwrap,
 * so deepClone reduces to JSON round-trip.
 */

export function deepClone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}
