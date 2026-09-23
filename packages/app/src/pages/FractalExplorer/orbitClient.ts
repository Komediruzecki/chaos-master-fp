/**
 * Main-thread side of the orbit worker: one request in flight at a time
 * from the caller's point of view, each newer one superseding the last.
 */
import type { GpuOrbitSet, OrbitRequest, OrbitResponse } from './orbitProtocol'

export interface OrbitResult {
  readonly set: GpuOrbitSet
  readonly ms: number
}

export interface OrbitClient {
  /** Resolves undefined when a newer request superseded this one. */
  request(request: Omit<OrbitRequest, 'id'>): Promise<OrbitResult | undefined>
  dispose(): void
}

export function createOrbitClient(
  onProgress: (fraction: number) => void,
): OrbitClient {
  const worker = new Worker(new URL('./orbitWorker.ts', import.meta.url), {
    type: 'module',
    name: 'explorer-orbit',
  })
  let nextId = 1
  let latest = 0
  const pending = new Map<
    number,
    {
      resolve: (r: OrbitResult | undefined) => void
      reject: (e: Error) => void
    }
  >()

  worker.addEventListener('message', (event: MessageEvent<OrbitResponse>) => {
    const message = event.data
    if (message.type === 'progress') {
      if (message.id === latest) onProgress(message.fraction)
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.type === 'done')
      entry.resolve({ set: message.set, ms: message.ms })
    else if (message.type === 'superseded') entry.resolve(undefined)
    else entry.reject(new Error(message.message))
  })
  worker.addEventListener('error', (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message))
    pending.clear()
  })

  return {
    request(request) {
      const id = nextId
      nextId += 1
      latest = id
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ ...request, id } satisfies OrbitRequest)
      })
    },
    dispose() {
      worker.terminate()
      for (const entry of pending.values()) entry.resolve(undefined)
      pending.clear()
    },
  }
}
