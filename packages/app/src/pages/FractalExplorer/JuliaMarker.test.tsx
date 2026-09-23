/**
 * The split view's point: a right-button press on the Mandelbrot pane puts c
 * under the pointer and keeps it there, with a mouse or with a pen's barrel
 * button, and that press never also pans the pane it shares a canvas with.
 */
import { pointAt } from '@chaos-master/core'
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachExplorerInput } from './explorerInput'
import { JuliaMarker } from './JuliaMarker'
import type { ComplexString, DeepZoomView } from '@chaos-master/core'

/** The pane the marker measures, swapped for a fresh canvas in each test. */
const pane = vi.hoisted(() => ({
  canvas: undefined as unknown as HTMLCanvasElement,
}))

vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({
    canvas: pane.canvas,
    canvasSize: () => ({ width: 800, height: 600 }),
  }),
}))

const VIEW: DeepZoomView = { centerRe: '-0.75', centerIm: '0', zoomLog2: 10 }
/** The pane's smaller side, which fixes the pixel spacing. */
const MIN_DIMENSION = 600
const CENTRE: ComplexString = { re: VIEW.centerRe, im: VIEW.centerIm }

beforeEach(() => {
  // An 800 x 600 CSS px pane at the page origin: its centre is (400, 300).
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: 800 })
  Object.defineProperty(canvas, 'clientHeight', { value: 600 })
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  canvas.setPointerCapture = () => {}
  document.body.append(canvas)
  pane.canvas = canvas
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

function mount(start: ComplexString = CENTRE) {
  const [point, setPoint] = createSignal(start)
  const onPoint = vi.fn(setPoint)
  const { container } = render(() => (
    <JuliaMarker view={() => VIEW} point={point} setPoint={onPoint} />
  ))
  const marker = container.querySelector('button') as HTMLButtonElement
  return { marker, onPoint, point }
}

function pointer(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  init: PointerEventInit = {},
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 4,
      pointerType: 'mouse',
      button: 0,
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  )
}

describe('the right-button pick', () => {
  it("moves c with a pen's barrel button and leaves the view where it is", () => {
    // The pane's own navigation is attached first, as the renderer does.
    const setView = vi.fn()
    const detach = attachExplorerInput(pane.canvas, {
      view: () => VIEW,
      setView,
      gridScale: () => 1,
      minDimension: () => MIN_DIMENSION,
    })
    const { point } = mount()
    const pen = { pointerType: 'pen', button: 2, buttons: 2 }
    pointer(pane.canvas, 'pointerdown', 500, 250, pen)
    pointer(pane.canvas, 'pointermove', 520, 260, { ...pen, button: -1 })
    pointer(pane.canvas, 'pointerup', 520, 260, pen)
    detach()
    expect(point()).toEqual(pointAt(VIEW, 120, -40, MIN_DIMENSION))
    expect(setView).not.toHaveBeenCalled()
  })
})
