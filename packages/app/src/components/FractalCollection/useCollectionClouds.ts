/** A single cancellable worker and twelve role clouds bound collection preview memory. */
import { createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { CollectionCloud, CollectionCloudReply, CollectionCloudRequest, } from './collectionCloudWorker'
import type { CollectionQuality } from './collectionStageLayout'

export function useCollectionClouds(
  id: () => string,
  quality: () => CollectionQuality,
) {
  const [clouds, setClouds] = createSignal<CollectionCloud[]>([])
  const [busy, setBusy] = createSignal(true)
  const [error, setError] = createSignal('')
  createEffect(
    on(
      () => `${id()}:${quality()}`,
      () => {
        setBusy(true)
        setError('')
        setClouds([])
        let worker: Worker | undefined
        let disposed = false
        let completed = false
        let timeout: ReturnType<typeof setTimeout> | undefined
        const fail = () => {
          if (completed) return
          completed = true
          if (!disposed) {
            setError(
              'The preview builder stopped. Choose another collection to try again.',
            )
            setBusy(false)
          }
          clearTimeout(timeout)
          worker?.terminate()
        }
        try {
          worker = new Worker(
            new URL('./collectionCloudWorker.ts', import.meta.url),
            { type: 'module' },
          )
          worker.onmessage = (event: MessageEvent<CollectionCloudReply>) => {
            if (disposed || completed) return
            completed = true
            if ('error' in event.data) setError(event.data.error)
            else setClouds(event.data.clouds)
            setBusy(false)
            clearTimeout(timeout)
            worker?.terminate()
          }
          worker.onerror = fail
          worker.onmessageerror = fail
          timeout = setTimeout(fail, 60_000)
          worker.postMessage({
            count: quality() === 'high' ? 60_000 : 24_000,
            collectionId: id(),
          } satisfies CollectionCloudRequest)
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not start this preview.',
          )
          setBusy(false)
          clearTimeout(timeout)
          worker?.terminate()
        }
        onCleanup(() => {
          disposed = true
          clearTimeout(timeout)
          worker?.terminate()
        })
      },
    ),
  )
  return { clouds, busy, error }
}
