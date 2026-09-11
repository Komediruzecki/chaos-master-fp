import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backDepth, popBack } from '@/lib/backStack'
import { CAPSULE_OPEN_MS, ShellBar } from './ShellBar'
import type { ShellDestination } from './ShellBar'

const selectionChanged = vi.fn()
vi.mock('@/lib/haptics', () => ({
  haptic: {
    impactLight: () => undefined,
    impactMedium: () => undefined,
    selectionChanged: () => selectionChanged(),
    success: () => undefined,
    warning: () => undefined,
    error: () => undefined,
    selectionStart: () => undefined,
    selectionEnd: () => undefined,
  },
}))

function mount(mode: 'full' | 'capsule', current: ShellDestination = 'create') {
  const onSelect = vi.fn()
  render(() => (
    <ShellBar
      mode={mode}
      current={() => current}
      onSelect={onSelect}
      more={{ onOpenSettings: () => undefined }}
    />
  ))
  return { onSelect }
}

const capsule = () => screen.getByLabelText('Create, navigation')

describe('ShellBar', () => {
  beforeEach(() => {
    selectionChanged.mockClear()
  })
  afterEach(cleanup)

  it('names its destinations and marks the current one', () => {
    const { onSelect } = mount('full', 'create')
    expect(
      screen
        .getByRole('button', { name: 'Create' })
        .getAttribute('aria-current'),
    ).toBe('page')
    const library = screen.getByRole('button', { name: 'Library' })
    expect(library.getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()

    library.click()
    expect(onSelect).toHaveBeenCalledWith('library')
    expect(selectionChanged).toHaveBeenCalledTimes(1)
  })

  /**
   * A real tap is pointerdown, pointerup, then click - in that order, with
   * the release before the click. Firing a click while the pointer is still
   * down is a sequence no browser produces, and it is what hid the bug this
   * suite now covers.
   */
  function tap(element: HTMLElement) {
    fireEvent.pointerDown(element)
    fireEvent.pointerUp(element)
    element.click()
  }

  it('opens on the touch down rather than on the release', () => {
    vi.useFakeTimers()
    mount('capsule')
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
    expect(capsule().getAttribute('aria-expanded')).toBe('false')

    // A press and hold shows the bar; the user should not have to let go to
    // find out whether anything happened.
    fireEvent.pointerDown(capsule())
    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy()
    expect(capsule().getAttribute('aria-expanded')).toBe('true')
    expect(backDepth()).toBe(1)
    vi.useRealTimers()
  })

  it('holds while the finger rests on it, and counts down from the release', () => {
    vi.useFakeTimers()
    mount('capsule')
    fireEvent.pointerDown(capsule())
    vi.advanceTimersByTime(CAPSULE_OPEN_MS * 2)
    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy()

    fireEvent.pointerUp(capsule())
    capsule().click()
    vi.advanceTimersByTime(CAPSULE_OPEN_MS - 1)
    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy()
    vi.advanceTimersByTime(1)
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
    expect(backDepth()).toBe(0)
    vi.useRealTimers()
  })

  it('does not collapse on the tap that opened it, or on the next one', () => {
    vi.useFakeTimers()
    mount('capsule')
    tap(capsule())
    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy()
    // The release's click used to toggle `expanded` back off, so the bar
    // closed the instant the finger lifted.
    tap(capsule())
    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy()
    vi.useRealTimers()
  })

  it('lets go of the bar when the finger lifts somewhere else', () => {
    vi.useFakeTimers()
    mount('capsule')
    fireEvent.pointerDown(capsule())
    // No pointer capture, so a finger that slides off releases over whatever
    // is under it; the countdown still has to start.
    fireEvent.pointerUp(document.body)
    vi.advanceTimersByTime(CAPSULE_OPEN_MS)
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
    vi.useRealTimers()
  })

  it('collapses on back', () => {
    vi.useFakeTimers()
    mount('capsule')
    tap(capsule())
    expect(popBack()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
    expect(backDepth()).toBe(0)
    vi.useRealTimers()
  })

  it('closes the More menu when the backdrop is tapped', () => {
    mount('full')
    screen.getByRole('button', { name: 'More' }).click()
    expect(screen.getByRole('menu')).toBeTruthy()

    screen.getByTestId('shell-more-backdrop').click()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(backDepth()).toBe(0)
  })

  it('opens the shared More list, and back closes it', () => {
    mount('full')
    screen.getByRole('button', { name: 'More' }).click()
    expect(screen.getByText('Settings and more')).toBeTruthy()
    expect(backDepth()).toBe(1)

    expect(popBack()).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(backDepth()).toBe(0)
  })
})
