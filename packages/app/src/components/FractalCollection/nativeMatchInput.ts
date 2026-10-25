/** Shared orbit and tap binding keeps match input independent from capture preparation. */
import { bindGummyTouchSurface, createGummyCameraInput, } from '../GummyBear/gummyCameraInput'
import { DEFAULT_BOARD_CAMERA } from '../PawnBoard/pawnBoardMath'
import type { GummyOrbit } from '../GummyBear/gummyStudyMath'

export function bindNativeMatchInput(options: {
  canvas: HTMLCanvasElement
  orbit: GummyOrbit
  ready: () => boolean
  cameraRadius: () => number
  selectAt: (x: number, y: number) => void
  invalidate: () => void
  visibility: () => void
}) {
  const { canvas, orbit, invalidate } = options
  let tap: { id: number; x: number; y: number } | undefined
  const input = createGummyCameraInput({
    canvas,
    orbit: () => orbit,
    mode: () => 'orbit',
    ready: options.ready,
    cameraRadius: options.cameraRadius,
    cancelGrip() {},
    pick() {},
    moveGrip() {},
  })

  function down(event: PointerEvent) {
    if (tap) tap = undefined
    else if (event.isPrimary && event.button === 0)
      tap = { id: event.pointerId, x: event.clientX, y: event.clientY }
    input.pointerDown(event)
  }

  function move(event: PointerEvent) {
    if (
      tap?.id === event.pointerId &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6
    )
      tap = undefined
    const { theta, phi, zoom, pan } = orbit
    input.pointerMove(event)
    if (
      orbit.theta !== theta ||
      orbit.phi !== phi ||
      orbit.zoom !== zoom ||
      orbit.pan !== pan
    )
      invalidate()
  }

  function end(event: PointerEvent) {
    const picked =
      event.type === 'pointerup' && tap?.id === event.pointerId
        ? tap
        : undefined
    tap = undefined
    input.pointerEnd(event)
    if (picked) options.selectAt(picked.x, picked.y)
    invalidate()
  }

  function wheel(event: WheelEvent) {
    input.wheel(event)
    invalidate()
  }

  function key(event: KeyboardEvent) {
    if (input.cameraKey(event)) event.preventDefault()
    else if (event.key === 'Home') {
      Object.assign(orbit, DEFAULT_BOARD_CAMERA, { pan: undefined })
      event.preventDefault()
    } else return
    invalidate()
  }
  canvas.tabIndex = 0
  canvas.style.cursor = 'grab'
  const releaseTouch = bindGummyTouchSurface(canvas)
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('lostpointercapture', end)
  canvas.addEventListener('pointerleave', input.pointerLeave)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('keydown', key)
  canvas.addEventListener('contextmenu', input.contextMenu)
  document.addEventListener('visibilitychange', options.visibility)
  return {
    cancelTap() {
      tap = undefined
    },
    dispose() {
      input.cancel()
      releaseTouch()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', end)
      canvas.removeEventListener('pointercancel', end)
      canvas.removeEventListener('lostpointercapture', end)
      canvas.removeEventListener('pointerleave', input.pointerLeave)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('keydown', key)
      canvas.removeEventListener('contextmenu', input.contextMenu)
      document.removeEventListener('visibilitychange', options.visibility)
    },
  }
}
