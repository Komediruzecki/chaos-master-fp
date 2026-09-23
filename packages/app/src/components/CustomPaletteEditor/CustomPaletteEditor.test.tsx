/**
 * Palette stops drag with any pointer, a finger included, and the selection
 * stays on the dragged stop when it passes a neighbour.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomPaletteEditor } from './CustomPaletteEditor'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const BAR_WIDTH = 200

function handles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-stop-id]')]
}

function handleAt(left: string): HTMLElement {
  const handle = handles().find((h) => h.style.left === left)
  if (!handle) throw new Error(`no stop at ${left}`)
  return handle
}

/** The editor's default two stops (0% and 100%) plus one clicked in at 50%. */
function renderWithThreeStops() {
  render(() => <CustomPaletteEditor onSave={vi.fn()} onCancel={vi.fn()} />)
  const bar = handles()[0]!.parentElement!
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: BAR_WIDTH,
    height: 40,
    right: BAR_WIDTH,
    bottom: 40,
    toJSON: () => ({}),
  })
  fireEvent.click(bar, { clientX: BAR_WIDTH / 2 })
  expect(handles()).toHaveLength(3)
}

function drag(handle: HTMLElement, fromX: number, toX: number, type: string) {
  const init = { pointerId: 7, pointerType: type, button: 0, bubbles: true }
  handle.dispatchEvent(
    new PointerEvent('pointerdown', { ...init, clientX: fromX, clientY: 20 }),
  )
  document.dispatchEvent(
    new PointerEvent('pointermove', { ...init, clientX: toX, clientY: 20 }),
  )
  document.dispatchEvent(
    new PointerEvent('pointerup', { ...init, clientX: toX, clientY: 20 }),
  )
}

describe('CustomPaletteEditor stop dragging', () => {
  it.each(['touch', 'mouse', 'pen'])('moves a stop dragged by %s', (type) => {
    renderWithThreeStops()
    const first = handleAt('0%')
    const id = first.dataset.stopId
    drag(first, 0, BAR_WIDTH * 0.25, type)
    expect(handleAt('25%').dataset.stopId).toBe(id)
  })

  it('keeps the dragged stop selected as it passes a neighbour', () => {
    renderWithThreeStops()
    const first = handleAt('0%')
    const id = first.dataset.stopId
    drag(first, 0, BAR_WIDTH * 0.75, 'touch')

    const moved = handleAt('75%')
    expect(moved.dataset.stopId).toBe(id)
    expect(screen.getByText(/Stop 2 \/ 3/)).toBeTruthy()

    fireEvent.click(screen.getByText('Delete Stop'))
    const left = handles().map((h) => h.dataset.stopId)
    expect(left).toHaveLength(2)
    expect(left).not.toContain(id)
  })

  it('does not nudge a stop that is only tapped', () => {
    renderWithThreeStops()
    const middle = handleAt('50%')
    drag(middle, BAR_WIDTH / 2, BAR_WIDTH / 2 + 2, 'touch')
    expect(handleAt('50%')).toBe(middle)
  })
})
