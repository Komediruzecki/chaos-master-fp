/**
 * The Arcade screen lock's shield, over everything while the agent drives.
 *
 * It is portalled under `<body>` so the rest of the page can be made inert
 * around it (screenLockInert.ts), and it holds the focus while it is up: no
 * control the viewer had focused keeps the keyboard. When it goes it hands
 * `onRelease` that control, for whoever takes the focus next.
 */
import { onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { inertOutside } from './screenLockInert'
import type { ParentProps } from 'solid-js'

export function LockShield(
  props: ParentProps<{
    class?: string
    label: string
    onRelease: (focusBefore: HTMLElement | undefined) => void
  }>,
) {
  let shield!: HTMLDivElement
  onMount(() => {
    const active = document.activeElement
    const focusBefore =
      active instanceof HTMLElement && active !== document.body
        ? active
        : undefined
    const release = inertOutside(shield)
    shield.focus({ preventScroll: true })
    onCleanup(() => {
      release()
      props.onRelease(focusBefore)
    })
  })
  return (
    <Portal>
      <div
        ref={shield}
        class={props.class}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
      >
        {props.children}
      </div>
    </Portal>
  )
}
