/**
 * Deep clones data using JSON round-trip.
 *
 * Uses JSON.parse(JSON.stringify()) instead of structuredClone because
 * structuredClone throws DataCloneError on iOS Safari and some other browsers.
 *
 * Runtime-agnostic version — does not depend on SolidJS unwrap.
 * For SolidJS-aware cloning, use the version in @/utils/clone in the app package.
 */
export function deepClone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}
