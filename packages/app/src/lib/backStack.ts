import { createSignal } from 'solid-js'

interface BackEntry {
  readonly handler: () => void
  readonly label: string
}

/**
 * One registry for "back". The Android back gesture, a sheet's downward drag
 * and the iOS edge swipe all pop it, and every layer that can be dismissed
 * pushes itself while it is open: a modal, the drawer, the top bar's menu,
 * the rail's detents, Home over the editor. The order is the order things
 * opened, so the newest layer answers first. When the stack is empty the
 * app minimises (lib/lifecycle.ts); nothing here ever calls history.back(),
 * because the tab switches use replaceState and "back" must leave the app,
 * not retrace which tab you looked at.
 */
const [entries, setEntries] = createSignal<readonly BackEntry[]>([])

export const backDepth = () => entries().length
export const backLabels = () => entries().map((entry) => entry.label)

export function pushBackHandler(
  handler: () => void,
  label: string,
): () => void {
  const entry: BackEntry = { handler, label }
  setEntries((list) => [...list, entry])
  return () => {
    setEntries((list) => list.filter((candidate) => candidate !== entry))
  }
}

/** Runs the top handler. False when there was nothing to pop. */
export function popBack(): boolean {
  const top = entries().at(-1)
  if (!top) return false
  top.handler()
  return true
}
