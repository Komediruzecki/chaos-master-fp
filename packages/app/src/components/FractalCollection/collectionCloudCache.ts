/** Per-preview sampling cache, bounded by both result count and retained typed-array bytes. */
import type { CollectionCloudReply } from './collectionCloudWorker'

type Result = Exclude<CollectionCloudReply, { error: string }>
export type CollectionCacheBudget = { maxEntries: number; maxBytes: number }

export function createCollectionCloudCache(budget?: CollectionCacheBudget) {
  const entries = new Map<string, { result: Result; bytes: number }>()
  let retained = 0
  return {
    get(key: string) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      entries.set(key, entry)
      return entry.result
    },
    set(key: string, result: Result) {
      if (!budget || budget.maxEntries < 1) return
      const bytes =
        result.clouds.reduce(
          (sum, cloud) =>
            sum + cloud.points.byteLength + cloud.colors.byteLength,
          0,
        ) +
        (result.shell?.vertices.byteLength ?? 0) +
        (result.solidShell?.vertices.byteLength ?? 0) +
        (result.solids?.reduce(
          (sum, solid) => sum + solid.vertices.byteLength,
          0,
        ) ?? 0)
      if (bytes > budget.maxBytes) return
      const previous = entries.get(key)
      retained -= previous?.bytes ?? 0
      entries.delete(key)
      entries.set(key, { result, bytes })
      retained += bytes
      while (entries.size > budget.maxEntries || retained > budget.maxBytes) {
        const oldest = entries.entries().next().value!
        retained -= oldest[1].bytes
        entries.delete(oldest[0])
      }
    },
    clear() {
      entries.clear()
      retained = 0
    },
  }
}
