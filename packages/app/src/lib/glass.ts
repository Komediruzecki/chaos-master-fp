/**
 * The switches that styles/designSystem/glass.module.css reads from <html>.
 * The stylesheet says what each one does; this module is the only thing that
 * writes them, so none can be left on by a surface that forgot to clear it.
 */
import { persistentSignal } from '@/utils/persistentSignal'
import type { Theme } from '@/contexts/ThemeContext'

const [glassPanels, storeGlassPanels] = persistentSignal<boolean>(
  'chaos-glass-panels',
  true,
)

/**
 * The Glass panels setting, on by default: the large panels that float over
 * the canvas as real glass, where blur costs the most
 * (docs/plans/glass-panels.md). Offered in Settings on every layout, for
 * whoever would rather have the frame rate. Stored like the touch layout
 * preference, and only once someone changes it, so the default can move.
 * Its toggle in Settings (HelpModal/GlassPanelsSetting.tsx), the rail's
 * sheet (TouchSurface/EditorRail.tsx) and the tablet deck
 * (TouchSurface/TabletInspectorDeck.tsx) read it here; stylesheets read the
 * attribute it puts on <html>, which glass.module.css describes.
 */
export { glassPanels }

export function setGlassPanels(on: boolean): void {
  storeGlassPanels(on)
  writeGlassPanels(on)
}

/**
 * Whether an optionalPanel is glass in `theme`: the setting is on and the
 * theme is not light. The same test, in code, as the gate in front of
 * glass.module.css's optionalPanel, for what a stylesheet cannot decide on its
 * own, such as the desktop sidebar floating over the canvas and how much of
 * the canvas the camera frames the flame beside
 * (WorkspaceSidebar/useSidebarGlass.ts). optionalPanelGlass.test.ts matches
 * the gate's own selector against this for every setting and theme, so the
 * two cannot disagree.
 */
export function optionalPanelGlass(theme: Theme): boolean {
  return glassPanels() && theme !== 'light'
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

/**
 * data-glass="busy": the editor canvas presents every frame, so the large
 * panels go solid. hooks/useWorkspaceGlassBusy.ts decides when, and is the
 * only caller.
 */
export function writeGlassBusy(busy: boolean): void {
  const root = document.documentElement
  if (busy) root.dataset.glass = 'busy'
  else delete root.dataset.glass
}
