/**
 * The page made inert around one element, for the Arcade's screen lock.
 *
 * A control that had focus when the agent took the screen kept it: a slider
 * took its arrows, a field its typing, a button its Space and Enter. `inert`
 * takes all of them out of focus, the pointer and the accessibility tree
 * without changing a pixel. It is set on the siblings of each of the
 * element's ancestors up to `<body>`. The shield is portalled straight under
 * `<body>`, so those are the app's root and the other portals, none of which
 * Solid sets `inert` on itself (CanvasViewport, the touch layouts). What was
 * already inert is left alone, and stays inert after the release.
 */

/** Elements that are never rendered or focused, so inert means nothing. */
const NEVER_INTERACTIVE = /^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/

/**
 * Make everything outside `keep` inert.
 *
 * @returns the release, which clears exactly the attributes this call set.
 */
export function inertOutside(keep: Element): () => void {
  const made: Element[] = []
  let node = keep
  while (node !== document.body && node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node) continue
      if (NEVER_INTERACTIVE.test(sibling.tagName)) continue
      if (sibling.hasAttribute('inert')) continue
      sibling.setAttribute('inert', '')
      made.push(sibling)
    }
    node = node.parentElement
  }
  return () => {
    for (const element of made) element.removeAttribute('inert')
  }
}

/**
 * Focus `element` again if it can still take focus: still on the page, not
 * inside something inert, and focusable at all.
 */
export function refocus(element: HTMLElement | undefined): void {
  if (!element?.isConnected) return
  if (element.closest('[inert]')) return
  element.focus({ preventScroll: true })
}
