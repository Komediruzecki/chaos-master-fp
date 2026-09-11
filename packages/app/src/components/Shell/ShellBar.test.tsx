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

  it('shows nothing but the capsule until it is tapped', () => {
    vi.useFakeTimers()
    mount('capsule')
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
    expect(capsule().getAttribute('aria-expanded')).toBe('false')

    capsule().click()
    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy()
    expect(capsule().getAttribute('aria-expanded')).toBe('true')
    expect(backDepth()).toBe(1)

    vi.advanceTimersByTime(CAPSULE_OPEN_MS)
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
    expect(backDepth()).toBe(0)
    vi.useRealTimers()
  })

  it('stays open while a finger is on it', () => {
    vi.useFakeTimers()
    mount('capsule')
    fireEvent.pointerDown(capsule())
    capsule().click()
    vi.advanceTimersByTime(CAPSULE_OPEN_MS * 2)
    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy()

    fireEvent.pointerUp(capsule())
    vi.advanceTimersByTime(CAPSULE_OPEN_MS - 1)
    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy()
    vi.advanceTimersByTime(1)
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
    vi.useRealTimers()
  })

  it('collapses on back', () => {
    vi.useFakeTimers()
    mount('capsule')
    capsule().click()
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
