/**
 * Click-and-drag scrubbing for a text input that keeps its look, as the
 * editor's ScrubInput does for its labels. A sideways drag on an input that
 * is not being edited reports how far it went; a press that does not move
 * focuses the input and selects its text, for typing. Shift makes the drag
 * ten times finer.
 *
 * Give the input `touch-action: pan-y`: a finger that moves mostly up or
 * down then still scrolls the panel around it, and only a sideways drag
 * reaches here.
 */
import { createDragHandler } from './createDragHandler'

/** CSS px a press may wander and still count as a click. */
const DEAD_ZONE = 4
/** Shift's share of a plain drag. */
const FINE = 0.1

export interface InputScrub {
  /** A drag began: read the value it starts from. */
  onStart: () => void
  /** CSS px dragged right since the last call, left negative, Shift applied. */
  onScrub: (dx: number) => void
}

export function createInputScrub(
  scrub: InputScrub,
): (event: PointerEvent) => void {
  return createDragHandler(
    (down) => {
      const input = down.currentTarget
      if (!(input instanceof HTMLInputElement)) return undefined
      // Being edited: a press places the caret, as in any text field.
      if (document.activeElement === input) return undefined
      // A mouse or pen press would focus the field and start selecting text
      // under the drag. A finger's tap focuses it natively, keyboard and all.
      if (down.pointerType !== 'touch') down.preventDefault()
      let lastX = down.clientX
      let dragging = false
      return {
        onPointerMove(move) {
          if (!dragging) {
            dragging = true
            scrub.onStart()
          }
          const dx = move.clientX - lastX
          lastX = move.clientX
          if (dx !== 0) scrub.onScrub(move.shiftKey ? dx * FINE : dx)
        },
        onDone(up) {
          // A press that did not move is a click: edit the value as text.
          if (dragging || !up) return
          input.focus()
          input.select()
        },
      }
    },
    { deadZoneRadius: DEAD_ZONE, preventDefault: false },
  )
}
