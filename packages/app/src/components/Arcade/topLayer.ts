/**
 * The Arcade screen lock in the browser's top layer.
 *
 * The shield is a modal `<dialog>`. The browser draws the newest modal
 * dialog above everything, every modal opened before it included, and makes
 * the rest of the page inert: the pointer, focus and the accessibility tree
 * (a document "blocked by a modal dialog"). That covers what opens after it,
 * too, with nothing to find: a panel, a toast or a tour portalled in mid-take
 * is inert from its first frame. Only a modal dialog opened later goes above
 * it, so the shield raises itself back over one the moment it opens. A
 * dialog that was open before the lock stays open under it, untouched, and
 * is the viewer's again when the shield goes.
 */

/**
 * Show `dialog` as the topmost modal and keep it there: over a modal opened
 * after it, and back up if the browser closes it (a close request the page
 * could not cancel). Focus stays in it, on the dialog itself unless the
 * viewer had moved it to a control inside.
 *
 * @returns the release, which closes it.
 */
export function holdTopLayer(dialog: HTMLDialogElement): () => void {
  const raise = () => {
    const active = document.activeElement
    const inside = active instanceof HTMLElement && dialog.contains(active)
    if (dialog.open) dialog.close()
    dialog.showModal()
    ;(inside ? active : dialog).focus({ preventScroll: true })
  }
  raise()
  // Microtasks, so a modal opened mid-take goes under before it is drawn.
  const watch = new MutationObserver((records) => {
    const over = records.some(
      ({ target }) =>
        target !== dialog && target instanceof HTMLDialogElement && target.open,
    )
    if (over || !dialog.open) raise()
  })
  watch.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
  })
  return () => {
    watch.disconnect()
    dialog.close()
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
