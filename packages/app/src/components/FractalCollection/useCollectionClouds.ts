/** Cancellable sampling with an optional preview-owned cache for quick collection comparisons. */
import { batch, createEffect, createMemo, createSignal, on, onCleanup, } from 'solid-js'
import { createCollectionCloudCache } from './collectionCloudCache'
import type { CollectionCacheBudget } from './collectionCloudCache'
import type { CollectionCloud, CollectionCloudReply, CollectionCloudRequest, } from './collectionCloudWorker'
import type { CollectionQuality } from './collectionStageLayout'
import type { FractalStudyGlass } from '@/flame/chess/fractalStudyGlass'
import type { WindowRookFracture } from '@/flame/chess/windowRookFracture'

export function useCollectionClouds(
  id: () => string,
  quality: () => CollectionQuality,
  options?: CollectionCacheBudget & { includeSolids?: boolean },
) {
  const [clouds, setClouds] = createSignal<CollectionCloud[]>([])
  const [shell, setShell] = createSignal<FractalStudyGlass>()
  const [solidShell, setSolidShell] = createSignal<FractalStudyGlass>()
  const [solids, setSolids] = createSignal<WindowRookFracture[]>()
  const [solidError, setSolidError] = createSignal('')
  const [busy, setBusy] = createSignal(true)
  const [error, setError] = createSignal('')
  const [resultKey, setResultKey] = createSignal('')
  const cache = createCollectionCloudCache(options)
  onCleanup(() => {
    cache.clear()
  })
  // Parent appearance objects also change for glass and scale. Only sampling
  // inputs should cancel a worker or replace already uploaded cloud arrays.
  const samplingKey = createMemo(
    () => `${id()}:${quality()}${options?.includeSolids ? ':solids' : ''}`,
  )
  createEffect(
    on(samplingKey, (key) => {
      const cached = cache.get(key)
      if (cached) {
        batch(() => {
          setResultKey(key)
          setShell(cached.shell)
          setSolidShell(cached.solidShell)
          setSolids(cached.solids)
          setSolidError(cached.solidError ?? '')
          setClouds(cached.clouds)
          setError('')
          setBusy(false)
        })
        return
      }
      setBusy(true)
      setResultKey('')
      setError('')
      setClouds([])
      setShell(undefined)
      setSolidShell(undefined)
      setSolids(undefined)
      setSolidError('')
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
          else {
            const result = event.data
            cache.set(key, result)
            batch(() => {
              setResultKey(key)
              setShell(result.shell)
              setSolidShell(result.solidShell)
              setSolids(result.solids)
              setSolidError(result.solidError ?? '')
              setClouds(result.clouds)
            })
          }
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
          ...(options?.includeSolids ? { includeSolids: true } : {}),
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
    }),
  )
  return {
    clouds,
    shell,
    solidShell,
    solids,
    solidError,
    busy,
    error,
    resultKey,
  }
}
