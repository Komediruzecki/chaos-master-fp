import { onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

export const LONG_PRESS_MS = 500

interface LongPressOptions {
  /** Fired at touch-down, before either outcome is known (the haptic goes here). */
  onPressStart?: () => void
  onTap: () => void
  onLongPress?: () => void
  ms?: number
}

type ButtonHandlers = Pick<
  JSX.HTMLAttributes<HTMLButtonElement>,
  | 'onPointerDown'
  | 'onPointerUp'
  | 'onPointerCancel'
  | 'onPointerLeave'
  | 'onClick'
>

/**
 * One button, two actions: a tap does the common thing, holding it opens the
 * fuller version. The click that follows a long press is swallowed, so the
 * finger lifting does not also fire the tap. Shared by the rail's shutter and
 * the tablet deck's save button, which offer the same pair.
 */
export function createLongPress(options: LongPressOptions): ButtonHandlers {
  let timer: ReturnType<typeof setTimeout> | null = null
  let longPressed = false

  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  onCleanup(cancel)

  return {
    onPointerDown: () => {
      options.onPressStart?.()
      longPressed = false
      if (!options.onLongPress) return
      timer = setTimeout(() => {
        longPressed = true
        options.onLongPress?.()
      }, options.ms ?? LONG_PRESS_MS)
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick: () => {
      if (longPressed) {
        longPressed = false
        return
      }
      options.onTap()
    },
  }
}
