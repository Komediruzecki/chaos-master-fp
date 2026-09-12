/**
 * Swap the document the editor is holding for another one.
 *
 * The order is the whole of it. `flushUnsaved` reads the OUTGOING flame and
 * its tracks and writes them to Recents; `replace` drops them. Run the other
 * way round, or not at all, and opening a flame destroys whatever was
 * unsaved in the one before it - which is what every way into the Library
 * except the desktop's own Load button used to do, because the flush lived
 * on that button rather than at the replacement.
 *
 * So it lives here, with a name, and every document replacement in
 * MainWorkspace goes through it: the Library load, the hand-off from the
 * welcome grid and Home, a randomizer-history load, New Flame, and the 2D/3D
 * switch, whose stash is in memory only. Three of those were still flushing
 * by hand while this said there were two - the claim is checked now, by a
 * test that fails on any call of the flush outside this function
 * (documentLoad.test.ts).
 */
export function replaceOpenDocument(steps: {
  /** Put whatever the open document is holding somewhere it survives. */
  flushUnsaved: () => void
  /** Then, and only then, put the new document in its place. */
  replace: () => void
}): void {
  steps.flushUnsaved()
  steps.replace()
}
