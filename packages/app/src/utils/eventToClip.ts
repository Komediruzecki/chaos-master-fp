import { vec2f } from 'typegpu/data'

interface CachedRect {
  readonly rect: DOMRectReadOnly
  readonly gesture: number
}

const rectCache = new WeakMap<HTMLElement, CachedRect>()
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    rectCache.delete(entry.target as HTMLElement)
  }
})

/**
 * Bumped when a gesture starts. A cached rect survives a *move*: the rail's
 * sheet translates the canvas without resizing it, so no ResizeObserver
 * fires and every pointer would map through the old position for as long as
 * the sheet stayed open. Measuring once per gesture keeps the per-move reads
 * free and the first sample of every gesture honest.
 */
let gesture = 0

if (typeof document !== 'undefined') {
  for (const type of ['pointerdown', 'touchstart', 'wheel'] as const) {
    document.addEventListener(
      type,
      () => {
        gesture += 1
      },
      { capture: true, passive: true },
    )
  }
}

export function getCachedBoundingRect(el: HTMLElement): DOMRectReadOnly {
  const cached = rectCache.get(el)
  if (cached && cached.gesture === gesture) return cached.rect
  const rect = el.getBoundingClientRect()
  if (!cached) resizeObserver.observe(el)
  rectCache.set(el, { rect, gesture })
  return rect
}

export function eventToClip(
  ev: { clientX: number; clientY: number },
  target: EventTarget | null,
) {
  if (!(target instanceof HTMLElement)) {
    return vec2f()
  }
  const rect = getCachedBoundingRect(target)
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const x = ((ev.clientX - centerX) / rect.width) * 2
  const y = ((centerY - ev.clientY) / rect.height) * 2
  return vec2f(x, y)
}
