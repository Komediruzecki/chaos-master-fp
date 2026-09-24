/**
 * The Glass panels row in Settings (lib/glass.ts): on by default, and the
 * one place a user turns the glass off, on every layout. Settings opens from
 * More ("Settings and more") and the tablet's rail on the touch layouts, and
 * from the version menu's "Settings and More" on the desktop.
 */
import { glassPanels, setGlassPanels } from '@/lib/glass'
import { Checkbox } from '../Checkbox/Checkbox'
import own from './GlassPanelsSetting.module.css'
import ui from './HelpModal.module.css'

const LABEL = 'Glass panels'

export function GlassPanelsSetting() {
  return (
    <label class={ui.pickerModeRow}>
      <span class={own.text}>
        <span class={ui.pickerModeLabel}>{LABEL}</span>
        <span class={own.hint}>
          Frosted glass over the artwork. Turn it off if the frame rate drops.
        </span>
      </span>
      <Checkbox
        aria-label={LABEL}
        checked={glassPanels()}
        onChange={(checked) => {
          setGlassPanels(checked)
        }}
      />
    </label>
  )
}
