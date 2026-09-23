/**
 * The one way the app starts a view transition, so renderers can tell when one
 * has ended.
 *
 * While a same-document view transition runs, Apple WebKit snapshots the page
 * on every frame, and each snapshot presents a WebGPU canvas's swap chain
 * without choosing what the canvas displays (GPUCanvasContextCocoa::
 * surfaceBufferToImageBuffer, Safari 26 and iOS 26). A renderer that stopped
 * drawing before the transition ended is left showing a buffer it did not draw
 * last, such as the flame that was loaded before. Renderers watch
 * `viewTransitionsSettled` and present their current image once more
 * (flame/renderDrivers/createInteractiveRenderDriver.ts).
 *
 * Where the API is missing, the update runs at once.
 */
import { createSignal } from 'solid-js'

const [settled, setSettled] = createSignal(0)

/**
 * Counts view transitions that have ended: finished, skipped, or failed in
 * their update callback. Read it to react to the end of each one.
 */
export const viewTransitionsSettled = settled

export function startViewTransition(update: () => void): void {
  if (!('startViewTransition' in document)) {
    update()
    return
  }
  const transition = document.startViewTransition(update)
  // A skipped transition rejects `ready`; the update still ran.
  transition.ready.catch(() => {})
  const done = () => {
    setSettled((count) => count + 1)
  }
  transition.finished.then(done, done)
}
