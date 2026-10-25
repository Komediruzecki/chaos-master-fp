/** Scene-owned contact baking with cancellation, a deadline and two cached takes for comparisons. */
import { nativeContactInput } from './nativeContactInput'
import type { NativeContactInput } from './nativeContactInput'
import type { NativeContactReply } from './nativeContactWorker'
import type { RookContactMotion } from '@/flame/chess/rookContactTypes'

export type PreparedNativeContact = {
  key: string
  victimId: number
  motion: RookContactMotion
}

export function createNativeContactPreparation() {
  const cache = new Map<string, PreparedNativeContact>()
  const sources = new WeakMap<object, number>()
  let nextSource = 0,
    disposed = false
  let pending:
    | { key: string; promise: Promise<PreparedNativeContact>; cancel(): void }
    | undefined
  const cancel = () => {
    pending?.cancel()
  }
  return {
    prepare(
      input: NativeContactInput,
    ): Promise<PreparedNativeContact | undefined> {
      if (disposed)
        return Promise.reject(new Error('This capture has been closed.'))
      let request: ReturnType<typeof nativeContactInput>
      try {
        request = nativeContactInput(input)
      } catch (error) {
        cancel()
        return Promise.reject(
          error instanceof Error
            ? error
            : new Error(
                typeof error === 'string'
                  ? error
                  : 'Contact preparation failed.',
                { cause: error },
              ),
        )
      }
      if (!request) {
        cancel()
        return Promise.resolve(undefined)
      }
      if (!sources.has(request.physics))
        sources.set(request.physics, ++nextSource)
      const { receipt, look } = input
      const key = JSON.stringify([
        sources.get(request.physics),
        receipt.before.fen,
        receipt.from,
        receipt.to,
        receipt.promotion,
        receipt.pieceId,
        receipt.captured?.id,
        look.scale,
      ])
      if (pending?.key === key) return pending.promise
      cancel()
      const cached = cache.get(key)
      if (cached) {
        cache.delete(key)
        cache.set(key, cached)
        return Promise.resolve(cached)
      }
      let worker: Worker | undefined,
        timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      let abort!: () => void
      const promise = new Promise<PreparedNativeContact>((resolve, reject) => {
        const finish = (error?: unknown, motion?: RookContactMotion) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          worker?.terminate()
          if (pending?.key === key) pending = undefined
          if (error) {
            reject(
              error instanceof Error
                ? error
                : new Error(
                    typeof error === 'string'
                      ? error
                      : 'Contact preparation failed.',
                    { cause: error },
                  ),
            )
            return
          }
          const result = {
            key,
            victimId: receipt.captured!.id,
            motion: motion!,
          }
          cache.set(key, result)
          while (cache.size > 2) cache.delete(cache.keys().next().value!)
          resolve(result)
        }
        abort = () => {
          finish(new DOMException('This capture was replaced.', 'AbortError'))
        }
        try {
          worker = new Worker(
            new URL('./nativeContactWorker.ts', import.meta.url),
            { type: 'module' },
          )
          worker.onmessage = (event: MessageEvent<NativeContactReply>) => {
            if ('error' in event.data) finish(new Error(event.data.error))
            else finish(undefined, event.data.motion)
          }
          worker.onerror = worker.onmessageerror = () => {
            finish(
              new Error(
                'The contact solver stopped. Choose another breakup to continue.',
              ),
            )
          }
          timer = setTimeout(() => {
            finish(new Error('This contact capture took too long to prepare.'))
          }, 30_000)
          // Physics is small and remains in the sampling cache. Transfer only
          // this request's path; never detach the geometry used by the scene.
          worker.postMessage(request, [request.attacker.path.buffer])
        } catch (error) {
          finish(error)
        }
      })
      if (!settled) pending = { key, promise, cancel: abort }
      return promise
    },
    cancel,
    dispose() {
      disposed = true
      cancel()
      cache.clear()
    },
  }
}
