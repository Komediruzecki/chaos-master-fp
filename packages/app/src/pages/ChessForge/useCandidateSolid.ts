/** Debounced, cancellable solid builds keep edits responsive and discard stale geometry. */
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { validateChessCandidate } from '@/flame/chess/chessCandidate'
import type { CandidateSolidData, CandidateSolidReply, } from './candidateSolidWorker'
import type { ChessCandidate } from '@/flame/chess/chessCandidate'

export function useCandidateSolid(
  candidate: () => ChessCandidate | undefined,
  enabled: () => boolean,
) {
  const [data, setData] = createSignal<CandidateSolidData>()
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const key = createMemo(() => {
    const current = candidate()
    if (!enabled() || !current?.solid) return ''
    // Identity/name changes do not change geometry. The worker still receives
    // an owned complete snapshot once the geometry inputs settle.
    return JSON.stringify([current.source, current.placement, current.solid])
  })

  createEffect(
    on(key, (next) => {
      setData(undefined)
      setError('')
      setBusy(!!next)
      if (!next) return
      let disposed = false
      let worker: Worker | undefined
      const timer = setTimeout(() => {
        try {
          worker = new Worker(
            new URL('./candidateSolidWorker.ts', import.meta.url),
            { type: 'module' },
          )
          worker.onmessage = (event: MessageEvent<CandidateSolidReply>) => {
            if (disposed) return
            setBusy(false)
            if ('error' in event.data) setError(event.data.error)
            else setData(event.data.data)
            worker?.terminate()
          }
          worker.onerror = () => {
            if (!disposed) {
              setError('The solid builder stopped. Switch views to try again.')
              setBusy(false)
            }
            worker?.terminate()
          }
          const current = candidate()
          if (!current) throw new Error('Choose a candidate to inspect.')
          // A temporarily empty draft name does not invalidate its geometry.
          worker.postMessage(
            validateChessCandidate({ ...current, name: 'Solid inspection' }),
          )
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not start the solid builder.',
          )
          setBusy(false)
          worker?.terminate()
        }
      }, 250)
      onCleanup(() => {
        disposed = true
        clearTimeout(timer)
        worker?.terminate()
      })
    }),
  )
  return { data, error, busy }
}
