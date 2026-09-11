import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLongPress } from './createLongPress'

function mount(options: {
  onTap: () => void
  onLongPress?: () => void
  onPressStart?: () => void
}) {
  render(() => (
    <button type="button" {...createLongPress(options)}>
      Save image
    </button>
  ))
  return screen.getByRole('button')
}

describe('createLongPress', () => {
  afterEach(cleanup)

  it('taps, and holds for the second action', () => {
    vi.useFakeTimers()
    const onTap = vi.fn()
    const onLongPress = vi.fn()
    const button = mount({ onTap, onLongPress })

    fireEvent.pointerDown(button, { pointerId: 1 })
    fireEvent.pointerUp(button, { pointerId: 1 })
    fireEvent.click(button)
    expect(onTap).toHaveBeenCalledTimes(1)
    expect(onLongPress).not.toHaveBeenCalled()

    fireEvent.pointerDown(button, { pointerId: 1 })
    vi.advanceTimersByTime(600)
    fireEvent.pointerUp(button, { pointerId: 1 })
    fireEvent.click(button)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onTap).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('does not fire once the finger that started the press has lifted', () => {
    vi.useFakeTimers()
    const onTap = vi.fn()
    const onLongPress = vi.fn()
    const button = mount({ onTap, onLongPress })

    // A second finger lands on the same button and the first one lifts. The
    // press belongs to the first finger, so nothing is left running to open
    // the export options with no finger on the screen.
    fireEvent.pointerDown(button, { pointerId: 1 })
    fireEvent.pointerDown(button, { pointerId: 2 })
    fireEvent.pointerUp(button, { pointerId: 1 })
    vi.advanceTimersByTime(600)
    expect(onLongPress).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('ignores a lift from a finger that did not start the press', () => {
    vi.useFakeTimers()
    const onTap = vi.fn()
    const onLongPress = vi.fn()
    const button = mount({ onTap, onLongPress })

    fireEvent.pointerDown(button, { pointerId: 1 })
    fireEvent.pointerUp(button, { pointerId: 9 })
    vi.advanceTimersByTime(600)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
