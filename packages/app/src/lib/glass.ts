/**
 * The switches that styles/designSystem/glass.module.css reads from <html>.
 * The stylesheet says what each one does; this module is the only thing that
 * writes them, so none can be left on by a surface that forgot to clear it.
 */
import { persistentSignal } from '@/utils/persistentSignal'

const [glassPanels, storeGlassPanels] = persistentSignal<boolean>(
  'chaos-glass-panels',
  false,
)

/**
 * The experimental Glass panels setting, off by default: the large touch
 * panels that float over the canvas as real glass, where blur costs the most
 * (docs/plans/glass-panels.md, phases 1 and 2). Stored like the touch layout
 * preference. Nothing reads it yet.
 */
export { glassPanels }

export function setGlassPanels(on: boolean): void {
  storeGlassPanels(on)
  writeGlassPanels(on)
}

/** Puts the stored setting on <html>; index.tsx calls it before the first render. */
export function applyGlassPanels(): void {
  writeGlassPanels(glassPanels())
}

function writeGlassPanels(on: boolean): void {
  const root = document.documentElement
  if (on) root.dataset.glassPanels = 'on'
  else delete root.dataset.glassPanels
}
