/** Native studio disclosure that preserves mounted controls and controlled open state. */
import { ChevronDown } from '@/icons'
import styles from './GummyCinemaPage.module.css'
import type { ParentProps } from 'solid-js'

export function GummyCinemaSection(
  props: ParentProps<{
    title: string
    open: boolean
    onToggle: (open: boolean) => void
    compact?: boolean
  }>,
) {
  return (
    <details
      class={styles.section}
      classList={{ [styles.compact!]: props.compact }}
      open={props.open}
      onToggle={(event) => {
        props.onToggle(event.currentTarget.open)
      }}
    >
      <summary>
        <span>{props.title}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div class={styles.sectionBody}>{props.children}</div>
    </details>
  )
}
