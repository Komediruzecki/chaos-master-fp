/** Shared pointer-read lifecycle and camera bindings for gummy study canvases. */
import { bindGummyTouchSurface, createGummyCameraInput, } from './gummyCameraInput'
import { gummyDragFrame } from './gummyStudyMath'
import type { GummyDragFrame, GummyGrip, GummyRay } from './gummyStudyMath'

type CameraOptions = Parameters<typeof createGummyCameraInput>[0]
type StudyInputOptions = Omit<
  CameraOptions,
  'pick' | 'moveGrip' | 'cancelGrip'
> & {
  rayAt(x: number, y: number): GummyRay
  disposed(): boolean
  canPick?(): boolean
  readPick(
    ray: GummyRay,
  ): Promise<{ point: [number, number, number]; grip: GummyGrip } | undefined>
  updateTarget(grip: GummyGrip, frame: GummyDragFrame, ray: GummyRay): void
  onPickStart(): void
  onRelease?(grip: GummyGrip | undefined): void
  onStatus?(status: 'ready' | 'picking' | 'dragging'): void
  onFailure(): void
  demo?(): boolean
}

export function createGummyStudyInput(options: StudyInputOptions) {
  let request = 0
  let picking = false
  let grip: GummyGrip | undefined
  let dragFrame: GummyDragFrame | undefined
  let dragPointer: number | undefined

  function cancelGrip() {
    options.onRelease?.(grip)
    request++
    picking = false
    grip = undefined
    dragFrame = undefined
    dragPointer = undefined
    if (!options.demo?.()) options.onStatus?.('ready')
  }

  function updateGrip(x: number, y: number) {
    if (grip && dragFrame)
      options.updateTarget(grip, dragFrame, options.rayAt(x, y))
  }

  async function pick(event: PointerEvent) {
    if (options.canPick && !options.canPick()) return
    const sequence = ++request
    const ray = options.rayAt(event.clientX, event.clientY)
    picking = true
    options.onPickStart()
    options.onStatus?.('picking')
    try {
      const picked = await options.readPick(ray)
      if (
        options.disposed() ||
        sequence !== request ||
        !input.pointer(event.pointerId)
      )
        return
      if (!picked) {
        options.onStatus?.('ready')
        return
      }
      dragFrame = gummyDragFrame(ray, picked.point)
      if (!dragFrame) {
        options.onStatus?.('ready')
        return
      }
      grip = picked.grip
      dragPointer = event.pointerId
      const latest = input.pointer(event.pointerId)!
      updateGrip(latest.x, latest.y)
      options.onStatus?.('dragging')
    } catch {
      if (!options.disposed() && sequence === request) options.onFailure()
    } finally {
      // An obsolete read must not clear the pending state of a newer pointer.
      if (sequence === request) picking = false
    }
  }

  const input = createGummyCameraInput({
    ...options,
    cancelGrip,
    pick: (event) => {
      void pick(event)
    },
    moveGrip: (x, y) => {
      if (dragPointer !== undefined) updateGrip(x, y)
    },
  })
  return {
    input,
    get grip() {
      return grip
    },
    get dragFrame() {
      return dragFrame
    },
    get picking() {
      return picking
    },
  }
}

export function createGummyStudyKeyboard(options: {
  input: ReturnType<typeof createGummyCameraInput>
  paused(): boolean
  onPauseChange?(paused: boolean): void
  onReplay?(): void
  onReset?(): void
  resetView(): void
}) {
  return (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.repeat && [' ', 'd', 'r'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      return
    }
    if (options.input.cameraKey(event)) {
      event.preventDefault()
      return
    }
    if (event.key === ' ') options.onPauseChange?.(!options.paused())
    else if (event.key.toLowerCase() === 'd') options.onReplay?.()
    else if (event.key.toLowerCase() === 'r') options.onReset?.()
    else if (event.key === 'Home') {
      options.input.cancel()
      options.resetView()
    } else if (event.key === 'Escape') options.input.cancel()
    else return
    event.preventDefault()
  }
}

export function bindGummyStudyCanvas(
  canvas: HTMLCanvasElement,
  input: ReturnType<typeof createGummyCameraInput>,
  keyDown: (event: KeyboardEvent) => void,
  pointers: Pick<
    typeof input,
    'pointerDown' | 'pointerMove' | 'pointerEnd'
  > = input,
) {
  canvas.tabIndex = 0
  canvas.style.cursor = 'grab'
  const releaseTouch = bindGummyTouchSurface(canvas)
  const handlers = {
    pointerdown: pointers.pointerDown,
    pointermove: pointers.pointerMove,
    pointerleave: input.pointerLeave,
    pointerup: pointers.pointerEnd,
    pointercancel: pointers.pointerEnd,
    lostpointercapture: pointers.pointerEnd,
    wheel: input.wheel,
    keydown: keyDown,
    contextmenu: input.contextMenu,
  }
  canvas.addEventListener('pointerdown', handlers.pointerdown)
  canvas.addEventListener('pointermove', handlers.pointermove)
  canvas.addEventListener('pointerleave', handlers.pointerleave)
  canvas.addEventListener('pointerup', handlers.pointerup)
  canvas.addEventListener('pointercancel', handlers.pointercancel)
  canvas.addEventListener('lostpointercapture', handlers.lostpointercapture)
  canvas.addEventListener('wheel', handlers.wheel, { passive: false })
  canvas.addEventListener('keydown', handlers.keydown)
  canvas.addEventListener('contextmenu', handlers.contextmenu)
  return () => {
    releaseTouch()
    canvas.removeEventListener('pointerdown', handlers.pointerdown)
    canvas.removeEventListener('pointermove', handlers.pointermove)
    canvas.removeEventListener('pointerleave', handlers.pointerleave)
    canvas.removeEventListener('pointerup', handlers.pointerup)
    canvas.removeEventListener('pointercancel', handlers.pointercancel)
    canvas.removeEventListener(
      'lostpointercapture',
      handlers.lostpointercapture,
    )
    canvas.removeEventListener('wheel', handlers.wheel)
    canvas.removeEventListener('keydown', handlers.keydown)
    canvas.removeEventListener('contextmenu', handlers.contextmenu)
  }
}
