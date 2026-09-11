import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHomeEdgeSwipe, EDGE_SWIPE_DISTANCE_PX, EDGE_SWIPE_START_PX, } from './edgeSwipe'

const popBack = vi.fn(() => true)
vi.mock('@/lib/backStack', () => ({
  popBack: () => popBack(),
}))

/** One pointer, from `fromX` to `toX`, in two moves. */
function swipe(fromX: number, toX: number) {
  let dispose = () => {}
  createRoot((disposeRoot) => {
    dispose = disposeRoot
    const start = createHomeEdgeSwipe()
    const target = document.createElement('div')
    document.body.append(target)
    const point = (type: string, clientX: number) =>
      new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY: 400,
        pointerId: 1,
      })
    start(point('pointerdown', fromX))
    const half = fromX + (toX - fromX) / 2
    document.dispatchEvent(point('pointermove', half))
    document.dispatchEvent(point('pointermove', toX))
    document.dispatchEvent(point('pointerup', toX))
    target.remove()
  })
  dispose()
}

describe('the Home edge swipe', () => {
  afterEach(() => {
    popBack.mockClear()
  })

  it('pops back once for a swipe in from the leading edge', () => {
    swipe(EDGE_SWIPE_START_PX - 4, EDGE_SWIPE_START_PX - 4 + 200)
    expect(popBack).toHaveBeenCalledTimes(1)
  })

  it('ignores a swipe that started away from the edge', () => {
    swipe(100, 300)
    expect(popBack).not.toHaveBeenCalled()
  })

  it('ignores a short drag at the edge, so a scroll is not a dismissal', () => {
    swipe(4, 4 + EDGE_SWIPE_DISTANCE_PX - 1)
    expect(popBack).not.toHaveBeenCalled()
  })
})
