/**
 * Canvas navigation: a drag pans by exactly the pointer's travel, and a pinch
 * pans with the fingers' midpoint and zooms by how far they spread. Every
 * result is compared, digit for digit, with the core's own `panView` and
 * `zoomViewAt`, which is what the explorer promises at any depth.
 */
import { panView, zoomViewAt } from '@chaos-master/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachExplorerInput } from './explorerInput'
import type { DeepZoomView } from '@chaos-master/core'

const START: DeepZoomView = { centerRe: '-0.75', centerIm: '0', zoomLog2: 10 }
/** The render grid's smaller side: 600 CSS px at 2 grid px each. */
const MIN_DIMENSION = 1200

let detach: (() => void) | undefined

afterEach(() => {
  detach?.()
  detach = undefined
  document.body.replaceChildren()
})

/** An 800 x 600 CSS px canvas at (100, 50), so its centre is at (500, 350). */
function setup() {
  const element = document.createElement('div')
  document.body.append(element)
  element.getBoundingClientRect = () => new DOMRect(100, 50, 800, 600)
  element.setPointerCapture = () => {}
  let view = START
  const setView = vi.fn((next: DeepZoomView) => {
    view = next
  })
  detach = attachExplorerInput(element, {
    view: () => view,
    setView,
    gridScale: () => 2,
    minDimension: () => MIN_DIMENSION,
  })

  function pointer(
    type: string,
    pointerId: number,
    clientX: number,
    clientY: number,
    init: PointerEventInit = {},
  ) {
    element.dispatchEvent(
      new PointerEvent(type, {
        pointerId,
        pointerType: 'touch',
        button: 0,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    )
  }
  return { element, setView, view: () => view, pointer }
}

describe('a pinch', () => {
  it('holds the zoom when the fingers meet, and zooms back as they part', () => {
    const { pointer, view } = setup()
    pointer('pointerdown', 1, 300, 300)
    pointer('pointerdown', 2, 500, 300)
    // 200 px apart to 100: one octave out.
    pointer('pointermove', 1, 400, 300)
    const apart = view()
    expect(apart.zoomLog2).toBe(9)

    // Both fingers on one pixel: there is no spread to compare with.
    pointer('pointermove', 2, 400, 300)
    expect(view()).toBe(apart)

    // 200 px apart again, measured from the last spread that had a size.
    pointer('pointermove', 2, 600, 300)
    expect(view()).toEqual(
      zoomViewAt(
        panView(apart, 100, 0, MIN_DIMENSION),
        0,
        -100,
        MIN_DIMENSION,
        1,
      ),
    )
    expect(view().zoomLog2).toBe(10)
  })
})

describe('a drag', () => {
  it.each(['mouse', 'pen', 'touch'])(
    'pans a %s drag by its travel in grid pixels',
    (type) => {
      const { pointer, view } = setup()
      pointer('pointerdown', 7, 500, 300, { pointerType: type })
      pointer('pointermove', 7, 510, 290, { pointerType: type })
      expect(view()).toEqual(panView(START, 20, -20, MIN_DIMENSION))
    },
  )

  // The right button belongs to the split view's point and the middle one to
  // the browser. A pen's barrel button is its right button.
  it.each([
    ['mouse', 1],
    ['mouse', 2],
    ['pen', 2],
  ])(
    'leaves the view alone for a %s pressed with button %i',
    (type, button) => {
      const { pointer, setView } = setup()
      pointer('pointerdown', 7, 500, 300, { pointerType: type, button })
      pointer('pointermove', 7, 540, 320, { pointerType: type })
      expect(setView).not.toHaveBeenCalled()
    },
  )
})
