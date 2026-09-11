import { popBack } from '@/lib/backStack'
import { createDragHandler } from '@/utils/createDragHandler'

/**
 * Home — the interactive edge swipe.
 *
 * iOS has no back gesture of its own (A/screens.md 0.5), and Home is the one
 * full-screen layer with somewhere to go back to. A drag that begins against
 * the leading edge and travels far enough to the right pops the back registry
 * once, which is the same thing the Android gesture does: it dismisses the
 * topmost layer, not necessarily Home, so a modal opened over Home still
 * closes first.
 */

/** How close to the leading edge a swipe has to start to be this gesture. */
export const EDGE_SWIPE_START_PX = 24

/** How far it has to travel. Short enough to be one flick, long enough that
 *  a horizontal nudge while scrolling the gallery is not a dismissal. */
export const EDGE_SWIPE_DISTANCE_PX = 60

export function createHomeEdgeSwipe() {
  return createDragHandler(
    (initEvent) => {
      if (initEvent.clientX > EDGE_SWIPE_START_PX) return undefined
      const startX = initEvent.clientX
      let popped = false
      return {
        onPointerMove(event) {
          if (popped) return
          if (event.clientX - startX < EDGE_SWIPE_DISTANCE_PX) return
          // Once per gesture: the rest of the drag is the finger leaving.
          popped = true
          popBack()
        },
      }
    },
    // The gallery below still has to scroll, and its plates still have to be
    // tappable, so this gesture never swallows the events it watches.
    { preventDefault: false },
  )
}
