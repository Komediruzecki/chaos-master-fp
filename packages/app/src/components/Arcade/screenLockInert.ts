/**
 * The page made inert around one element, for the Arcade's screen lock.
 *
 * The lock's shield swallows the pointer, but a control that had focus when
 * the agent took the screen kept it: a slider took its arrows, a field its
 * typing, a button its Space and Enter. `inert` takes every one of them out
 * of focus, the pointer and the accessibility tree at once, without touching
 * a pixel of what the viewer is watching.
 *
 * It is set on the siblings of each of the element's ancestors, up to
 * `<body>`, so the element itself and the chain holding it stay live. The
 * shield is portalled straight under `<body>`, which makes that chain one
 * container and its siblings the app's own root and the other portals:
 * nothing whose `inert` Solid manages itself (CanvasViewport, the touch
 * layouts), so the two never fight over the attribute. An element that was
 * already inert is left alone, and stays inert after the release.
 */

/** Elements that are never rendered or focused, so inert means nothing. */
const NEVER_INTERACTIVE = new Set([
  'SCRIPT',
  'STYLE',
  'LINK',
  'META',
  'TEMPLATE',
  'NOSCRIPT',
])

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
      if (NEVER_INTERACTIVE.has(sibling.tagName)) continue
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
