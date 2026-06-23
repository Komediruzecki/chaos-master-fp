import { createEffect, createSignal, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'

type ObserverCallback = (entry: IntersectionObserverEntry) => void

let sharedObserver: IntersectionObserver | null = null
const observerCallbacks = new Map<Element, ObserverCallback>()

function getSharedObserver() {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const callback = observerCallbacks.get(entry.target)
        if (callback) {
          callback(entry)
        }
      }
    })
  }
  return sharedObserver
}

export function useIntersectionObserver(
  target: Accessor<HTMLElement | null | undefined>,
  onChange?: (isVisible: boolean) => void,
) {
  const [intersection, setIntersection] =
    createSignal<IntersectionObserverEntry>()

  createEffect(() => {
    const t = target()
    if (!t) return

    const observer = getSharedObserver()

    observerCallbacks.set(t, (entry) => {
      if (entry === undefined || !t.isConnected) {
        setIntersection(undefined)
        return
      }
      const isVisible = entry.isIntersecting
      if (onChange !== undefined) {
        onChange(isVisible)
      }
      setIntersection(entry)
    })

    observer.observe(t)

    onCleanup(() => {
      observer.unobserve(t)
      observerCallbacks.delete(t)
    })
  })

  return intersection
}
