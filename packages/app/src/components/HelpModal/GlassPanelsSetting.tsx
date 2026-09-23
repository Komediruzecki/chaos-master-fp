/**
 * The Glass panels row in Settings (lib/glass.ts). Offered on the touch
 * layouts only: the panels it turns to glass are theirs, and on the desktop
 * it would change nothing. Settings is where the touch layouts send you from
 * More ("Settings and more") and from the tablet's rail.
 */
import { Show } from 'solid-js'
import { glassPanels, setGlassPanels } from '@/lib/glass'
import { isTouchLayout } from '@/stores/workspaceLayoutStore'
import { Checkbox } from '../Checkbox/Checkbox'
import own from './GlassPanelsSetting.module.css'
import ui from './HelpModal.module.css'

const LABEL = 'Glass panels (experimental)'

export function GlassPanelsSetting() {
  return (
    <Show when={isTouchLayout()}>
      <label class={ui.pickerModeRow}>
        <span class={own.text}>
          <span class={ui.pickerModeLabel}>{LABEL}</span>
          <span class={own.hint}>
            May lower the frame rate on older devices.
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
    </Show>
  )
}
