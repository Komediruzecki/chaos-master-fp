/** Match-owned mould cache: share compact meshes across scenes without retaining a global GPU cache. */
import { gummyAuthoredPawnKey } from '@/simulation/gummy/gummyAuthoredPawn'
import { createGummyBoardRestMeshes } from './gummyBoardRestMeshes'
import type { TgpuRoot } from 'typegpu'
import type { GummyBoardRestMeshes } from './gummyBoardRestMeshes'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'
import type { GummyChessArtStyle } from '@/simulation/gummy/gummyChessMoulds'

type Entry = {
  controller: AbortController
  pending: Promise<GummyBoardRestMeshes>
  resource?: GummyBoardRestMeshes
  borrowers: number
  retired: boolean
  destroyed: boolean
}

function destroyUnused(entry: Entry) {
  if (!entry.retired || entry.borrowers || entry.destroyed || !entry.resource)
    return
  entry.destroyed = true
  entry.resource.destroy()
}

/** Each caller owns a lease; aborting a pending caller cannot invalidate another scene's mesh. */
function borrow(
  entry: Entry,
  signal: AbortSignal | undefined,
  release: () => void,
) {
  return new Promise<GummyBoardRestMeshes>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      release()
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Mesh preparation cancelled', 'AbortError'),
      )
    }
    signal?.addEventListener('abort', abort, { once: true })
    entry.pending.then(
      (resource) => {
        if (settled) return
        settled = true
        cleanup()
        if (entry.retired) {
          release()
          reject(new DOMException('Mesh pool closed', 'AbortError'))
          return
        }
        resolve({ meshes: resource.meshes, destroy: release })
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        release()
        reject(
          error instanceof Error
            ? error
            : new Error('Gummy board mesh preparation failed', {
                cause: error,
              }),
        )
      },
    )
  })
}

export function createGummyBoardRestMeshPool() {
  const roots = new Map<TgpuRoot, Map<string, Entry>>()
  let disposed = false
  return {
    async acquire(
      root: TgpuRoot,
      device: GPUDevice,
      spacing: number,
      artStyle: GummyChessArtStyle = 'classic',
      signal?: AbortSignal,
      authoredPawn?: GummyAuthoredPawn,
    ): Promise<GummyBoardRestMeshes> {
      signal?.throwIfAborted()
      if (disposed) throw new Error('Gummy board mesh pool is closed')
      if (root.device !== device)
        throw new Error('Gummy board mesh pool root and device must match')
      const entries = roots.get(root) ?? new Map<string, Entry>()
      roots.set(root, entries)
      const key = `${artStyle}:${spacing}:${gummyAuthoredPawnKey(authoredPawn)}`
      let entry = entries.get(key)
      if (!entry) {
        const controller = new AbortController()
        const next: Entry = {
          controller,
          borrowers: 0,
          retired: false,
          destroyed: false,
          pending: createGummyBoardRestMeshes(
            root,
            device,
            spacing,
            artStyle,
            controller.signal,
            authoredPawn,
          ).then(
            (resource) => {
              next.resource = resource
              destroyUnused(next)
              return resource
            },
            (error: unknown) => {
              if (entries.get(key) === next) entries.delete(key)
              throw error
            },
          ),
        }
        entries.set(key, next)
        entry = next
      }
      // Preserve active capture leases; retain at most two idle look variants.
      const prune = () => {
        const idle = [...entries.entries()].filter(
          ([, item]) => !item.borrowers,
        )
        for (const [oldKey, old] of idle.slice(
          0,
          Math.max(0, idle.length - 2),
        )) {
          entries.delete(oldKey)
          old.retired = true
          old.controller.abort()
          destroyUnused(old)
        }
      }
      const borrowed = entry
      borrowed.borrowers++
      // Refresh insertion order for least-recently-used idle eviction.
      entries.delete(key)
      entries.set(key, borrowed)
      prune()
      let released = false
      const release = () => {
        if (released) return
        released = true
        borrowed.borrowers--
        if (!borrowed.borrowers && !borrowed.resource) {
          if (entries.get(key) === borrowed) entries.delete(key)
          borrowed.retired = true
          borrowed.controller.abort()
        }
        destroyUnused(borrowed)
        prune()
      }
      return borrow(borrowed, signal, release)
    },
    destroy() {
      if (disposed) return
      disposed = true
      for (const entries of roots.values())
        for (const entry of entries.values()) {
          entry.retired = true
          entry.controller.abort()
          destroyUnused(entry)
        }
      roots.clear()
    },
  }
}

export type GummyBoardRestMeshPool = ReturnType<
  typeof createGummyBoardRestMeshPool
>
