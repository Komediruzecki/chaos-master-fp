/** Shared camera gestures keep touch navigation separate from material grips. */
import { gummyCameraRadius } from './gummyStudyMath'
import type { GummyGrip, GummyOrbit, GummyVec3 } from './gummyStudyMath'

export type GummyInteraction = 'drag' | 'orbit' | 'pan'
type Pointer = { x: number; y: number; touch: boolean }
type Cursor = { x: number; y: number; down: boolean }

/** Stop native selection gestures at the canvas; PointerEvents still own every grip. */
export function bindGummyTouchSurface(canvas: HTMLCanvasElement) {
  const properties = [
    'touch-action',
    'user-select',
    '-webkit-user-select',
    '-webkit-touch-callout',
  ]
  const previous = properties.map((property) => ({
    property,
    value: canvas.style.getPropertyValue(property),
    priority: canvas.style.getPropertyPriority(property),
  }))
  for (const property of properties) canvas.style.setProperty(property, 'none')

  // WebKit's native selection gestures are separate from pointer defaults.
  // Cancel them on this interactive surface, leaving page scrolling untouched.
  function preventNativeGesture(event: TouchEvent) {
    if (event.cancelable) event.preventDefault()
  }
  canvas.addEventListener('touchstart', preventNativeGesture, {
    passive: false,
  })
  canvas.addEventListener('touchmove', preventNativeGesture, { passive: false })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    canvas.removeEventListener('touchstart', preventNativeGesture)
    canvas.removeEventListener('touchmove', preventNativeGesture)
    for (const { property, value, priority } of previous) {
      if (value) canvas.style.setProperty(property, value, priority)
      else canvas.style.removeProperty(property)
    }
  }
}

/** Translate eye and target so a point at the target depth follows the pointer. */
export function panGummyOrbit(
  orbit: GummyOrbit,
  dx: number,
  dy: number,
  width: number,
  height: number,
  experiment: 'pull' | 'crush' = 'pull',
  cameraRadius?: number,
) {
  if (width <= 0 || height <= 0 || !Number.isFinite(dx + dy)) return
  const scale =
    (2 *
      (cameraRadius ?? gummyCameraRadius(orbit, width / height, experiment)) *
      Math.tan(Math.PI / 8)) /
    height
  const right = [Math.cos(orbit.theta), 0, -Math.sin(orbit.theta)]
  const up = [
    -Math.cos(orbit.phi) * Math.sin(orbit.theta),
    Math.sin(orbit.phi),
    -Math.cos(orbit.phi) * Math.cos(orbit.theta),
  ]
  const pan: GummyVec3 = orbit.pan ?? [0, 0, 0]
  orbit.pan = [
    pan[0] + scale * (-dx * right[0]! + dy * up[0]!),
    pan[1] + scale * dy * up[1]!,
    pan[2] + scale * (-dx * right[2]! + dy * up[2]!),
  ]
}

type GummyInputOptions = {
  canvas: HTMLCanvasElement
  orbit: () => GummyOrbit
  mode: () => GummyInteraction
  ready: () => boolean
  experiment?: 'pull' | 'crush'
  cameraRadius?: () => number
  cancelGrip: () => void
  pick: (event: PointerEvent) => void
  moveGrip: (x: number, y: number) => void
}

export function createGummyCameraInput(options: GummyInputOptions) {
  const pointers = new Map<number, Pointer>()
  let action: GummyInteraction = 'drag'
  let cursor: Cursor | undefined

  function cancel() {
    options.cancelGrip()
    cursor = undefined
    const ids = [...pointers.keys()]
    // Clear before releasing capture: lostpointercapture may dispatch immediately.
    pointers.clear()
    for (const id of ids)
      if (options.canvas.hasPointerCapture(id))
        options.canvas.releasePointerCapture(id)
  }

  function orbitBy(dx: number, dy: number) {
    const orbit = options.orbit()
    orbit.theta -= dx * 0.005
    orbit.phi = Math.max(0.4, Math.min(1.53, orbit.phi - dy * 0.005))
  }

  function panBy(dx: number, dy: number) {
    const bounds = options.canvas.getBoundingClientRect()
    panGummyOrbit(
      options.orbit(),
      dx,
      dy,
      bounds.width,
      bounds.height,
      options.experiment,
      options.cameraRadius?.(),
    )
  }

  function zoomBy(factor: number) {
    const orbit = options.orbit()
    orbit.zoom = Math.max(0.65, Math.min(1.8, orbit.zoom * factor))
  }

  function pointerDown(event: PointerEvent) {
    if (
      event.button < 0 ||
      event.button > 2 ||
      !options.ready() ||
      pointers.size >= 2
    )
      return
    const touch = event.pointerType === 'touch'
    // Only a second touch participates in a two-pointer gesture.
    if (
      pointers.size &&
      (!touch || ![...pointers.values()].every((pointer) => pointer.touch))
    )
      return
    event.preventDefault()
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, touch })
    options.canvas.setPointerCapture(event.pointerId)
    options.canvas.focus({ preventScroll: true })
    if (pointers.size === 2) {
      cursor = undefined
      options.cancelGrip()
      // Keep the remaining finger in navigation after either finger is lifted.
      action = 'pan'
    } else {
      action =
        event.button === 1 || event.shiftKey
          ? 'pan'
          : event.button === 2
            ? 'orbit'
            : options.mode()
      cursor =
        action === 'drag'
          ? { x: event.clientX, y: event.clientY, down: true }
          : undefined
      if (action === 'drag') options.pick(event)
      else options.cancelGrip()
    }
  }

  function pointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) {
      if (!pointers.size && event.pointerType !== 'touch')
        cursor =
          options.mode() === 'drag'
            ? { x: event.clientX, y: event.clientY, down: false }
            : undefined
      return
    }
    event.preventDefault()
    const dx = event.clientX - previous.x,
      dy = event.clientY - previous.y
    const other = [...pointers.entries()].find(
      ([id]) => id !== event.pointerId,
    )?.[1]
    if (other) {
      panBy(dx / 2, dy / 2)
      const before = Math.hypot(previous.x - other.x, previous.y - other.y)
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
      if (before > 1 && after > 1) zoomBy(before / after)
    } else if (action === 'orbit') orbitBy(dx, dy)
    else if (action === 'pan') panBy(dx, dy)
    else if (event.shiftKey) {
      options.cancelGrip()
      cursor = undefined
      action = 'pan'
      panBy(dx, dy)
    } else {
      cursor = { x: event.clientX, y: event.clientY, down: true }
      options.moveGrip(event.clientX, event.clientY)
    }
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      touch: previous.touch,
    })
  }

  function pointerEnd(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    pointers.delete(event.pointerId)
    cursor =
      !previous.touch && action === 'drag' && event.type === 'pointerup'
        ? { x: event.clientX, y: event.clientY, down: false }
        : undefined
    if (action === 'drag') options.cancelGrip()
    if (options.canvas.hasPointerCapture(event.pointerId))
      options.canvas.releasePointerCapture(event.pointerId)
  }

  function pointerLeave() {
    if (!pointers.size) cursor = undefined
  }

  function wheel(event: WheelEvent) {
    event.preventDefault()
    if (pointers.size) cancel()
    zoomBy(Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * 0.0015))
  }

  function cameraKey(event: KeyboardEvent) {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-18, 0],
      ArrowRight: [18, 0],
      ArrowUp: [0, -18],
      ArrowDown: [0, 18],
    }
    const direction = directions[event.key]
    if (direction) {
      cancel()
      if (event.shiftKey) panBy(direction[0], direction[1])
      else orbitBy(direction[0], direction[1])
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      cancel()
      zoomBy(event.key === '-' ? 1.12 : 1 / 1.12)
    } else return false
    return true
  }

  function contextMenu(event: Event) {
    event.preventDefault()
  }

  function guide(grip?: GummyGrip, origin?: GummyVec3) {
    if (!cursor || options.mode() !== 'drag') return undefined
    const bounds = options.canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return undefined
    return {
      x: (cursor.x - bounds.left) / bounds.width,
      y: (cursor.y - bounds.top) / bounds.height,
      active: cursor.down && !!grip,
      target: grip?.target,
      origin: grip ? origin : undefined,
    }
  }

  return {
    cancel,
    cursor: () => cursor,
    guide,
    pointer: (id: number) => (action === 'drag' ? pointers.get(id) : undefined),
    pointerDown,
    pointerMove,
    pointerEnd,
    pointerLeave,
    wheel,
    cameraKey,
    contextMenu,
  }
}
