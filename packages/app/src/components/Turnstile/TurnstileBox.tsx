import { onCleanup, onMount } from 'solid-js'
import { loadTurnstile, TURNSTILE_SITE_KEY } from '@/utils/turnstile'
import ui from './TurnstileBox.module.css'

/** Whether the build carries a site key (widget + token flow active). */
export function turnstileEnabled(): boolean {
  return Boolean(TURNSTILE_SITE_KEY)
}

/**
 * Cloudflare Turnstile widget as a drop-in form row. Reports token changes via
 * `onToken` ('' when expired/errored) and hands back a reset function through
 * `resetRef` — call it after every submit, tokens are single-use.
 *
 * Render only when `turnstileEnabled()`; without a site key this component is
 * a no-op and the Worker (which only enforces when TURNSTILE_SECRET is set)
 * accepts tokenless requests.
 */
export function TurnstileBox(props: {
  onToken: (token: string) => void
  resetRef?: (reset: () => void) => void
}) {
  let el: HTMLDivElement | undefined
  let widgetId: string | undefined

  onMount(() => {
    const siteKey = TURNSTILE_SITE_KEY
    if (!siteKey || !el) return
    void loadTurnstile()
      .then(() => {
        if (!el || !window.turnstile) return
        widgetId = window.turnstile.render(el, {
          sitekey: siteKey,
          theme: 'auto',
          size: 'flexible',
          callback: (t) => {
            props.onToken(t)
          },
          'expired-callback': () => {
            props.onToken('')
          },
          'error-callback': () => {
            props.onToken('')
          },
          'timeout-callback': () => {
            props.onToken('')
          },
        })
        props.resetRef?.(() => {
          if (widgetId && window.turnstile) {
            try {
              window.turnstile.reset(widgetId)
            } catch {
              // ignore
            }
          }
          props.onToken('')
        })
      })
      .catch(() => {
        // Script blocked/failed — leave the box empty; the Worker stays the
        // authority and will reject if it requires a token.
      })
  })

  onCleanup(() => {
    if (widgetId && window.turnstile) {
      try {
        window.turnstile.remove(widgetId)
      } catch {
        // ignore
      }
    }
  })

  return <div class={ui.turnstile} ref={el} />
}
