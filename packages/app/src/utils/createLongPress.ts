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
 *
 * The press belongs to the finger that started it. A second finger landing on
 * the same button is not a second press, and a lift from another pointer does
 * not end this one: otherwise the second touch-down orphaned the first timer,
 * which fired the long press with nothing on the screen.
 */
export function createLongPress(options: LongPressOptions): ButtonHandlers {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pressedBy: number | null = null
  let longPressed = false

  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pressedBy = null
  }
  onCleanup(cancel)

  const endPress = (event: PointerEvent) => {
    if (pressedBy !== null && event.pointerId !== pressedBy) return
    cancel()
  }

  return {
    onPointerDown: (event: PointerEvent) => {
      if (pressedBy !== null) return
      pressedBy = event.pointerId
      options.onPressStart?.()
      longPressed = false
      if (!options.onLongPress) return
      timer = setTimeout(() => {
        timer = null
        longPressed = true
        options.onLongPress?.()
      }, options.ms ?? LONG_PRESS_MS)
    },
    onPointerUp: endPress,
    onPointerCancel: endPress,
    onPointerLeave: endPress,
    onClick: () => {
      if (longPressed) {
        longPressed = false
        return
      }
      options.onTap()
    },
  }
}
