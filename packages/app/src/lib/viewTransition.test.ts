// lib/viewTransition: the update always runs, and every transition that ends,
// however it ends, is counted exactly once, after it has ended.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startViewTransition, viewTransitionsSettled } from './viewTransition'

function fakeTransitions() {
  const started: {
    update: () => void
    ready: PromiseWithResolvers<undefined>
    finished: PromiseWithResolvers<undefined>
  }[] = []
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: (update: () => void) => {
      const entry = {
        update,
        ready: Promise.withResolvers<undefined>(),
        finished: Promise.withResolvers<undefined>(),
      }
      started.push(entry)
      return {
        ready: entry.ready.promise,
        finished: entry.finished.promise,
        updateCallbackDone: Promise.resolve(),
        skipTransition: () => {},
      }
    },
  })
  return started
}

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

describe('startViewTransition', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition')
  })

  it('runs the update at once where the API is missing', () => {
    Reflect.deleteProperty(document, 'startViewTransition')
    const before = viewTransitionsSettled()
    const update = vi.fn()
    startViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
    // No transition ran, so there is nothing to recover from.
    expect(viewTransitionsSettled()).toBe(before)
  })

  it('hands the update to the browser and counts the end, not the start', async () => {
    const started = fakeTransitions()
    const before = viewTransitionsSettled()
    const update = vi.fn()
    startViewTransition(update)
    expect(started).toHaveLength(1)
    expect(started[0]?.update).toBe(update)

    started[0]?.ready.resolve(undefined)
    await settle()
    expect(viewTransitionsSettled()).toBe(before)

    started[0]?.finished.resolve(undefined)
    await settle()
    expect(viewTransitionsSettled()).toBe(before + 1)
  })

  it('counts a transition that was skipped or whose update failed', async () => {
    const started = fakeTransitions()
    const before = viewTransitionsSettled()
    startViewTransition(() => {})
    startViewTransition(() => {})
    // A skipped transition rejects `ready`; a failed update rejects both.
    // Neither may surface as an unhandled rejection.
    started[0]?.ready.reject(new DOMException('skipped', 'AbortError'))
    started[0]?.finished.resolve(undefined)
    started[1]?.ready.reject(new Error('update failed'))
    started[1]?.finished.reject(new Error('update failed'))
    await settle()
    expect(viewTransitionsSettled()).toBe(before + 2)
  })
})
