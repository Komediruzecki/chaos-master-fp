/** A copyable simulation error beside the canvas, without covering its unused hit area. */
import { createSignal, createUniqueId, onCleanup, Show } from 'solid-js'
import { ChevronDown, Copy, TriangleAlert } from '@/icons'
import styles from './GummyErrorNotice.module.css'

export function GummyErrorNotice(props: { message: string }) {
  const [open, setOpen] = createSignal(false)
  const [copyState, setCopyState] = createSignal<
    'idle' | 'copying' | 'copied' | 'unavailable'
  >('idle')
  const panelId = createUniqueId()
  let toggle: HTMLButtonElement | undefined
  let log: HTMLTextAreaElement | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const copyError = async () => {
    setCopyState('copying')
    try {
      await globalThis.navigator.clipboard.writeText(props.message)
      if (!disposed) setCopyState('copied')
    } catch {
      if (disposed) return
      setCopyState('unavailable')
      log?.focus()
      log?.select()
    }
  }

  return (
    <div
      class={styles.notice}
      data-testid="gummy-error-notice"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open()) return
        event.stopPropagation()
        setOpen(false)
        toggle?.focus()
      }}
    >
      <span class={styles.announcement} role="alert">
        {props.message}
      </span>
      <button
        ref={toggle}
        type="button"
        class={styles.toggle}
        aria-expanded={open()}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <TriangleAlert aria-hidden="true" />
        Simulation error
        <ChevronDown class={styles.chevron} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div
          id={panelId}
          class={styles.panel}
          role="region"
          aria-label="Error details"
        >
          <p>The simulation stopped. Copy the error to share what happened.</p>
          <textarea
            ref={log}
            class={styles.log}
            aria-label="Simulation error log"
            readOnly
            value={props.message}
            spellcheck={false}
          />
          <button
            type="button"
            class={styles.copy}
            onClick={() => void copyError()}
            disabled={copyState() === 'copying'}
          >
            <Copy aria-hidden="true" />
            {copyState() === 'copied' ? 'Copied' : 'Copy error'}
          </button>
          <p class={styles.copyStatus} role="status">
            {copyState() === 'unavailable'
              ? 'Copy was blocked. The text is selected so you can copy it manually.'
              : copyState() === 'copied'
                ? 'Error copied.'
                : 'Share this log when reporting the problem.'}
          </p>
        </div>
      </Show>
    </div>
  )
}
