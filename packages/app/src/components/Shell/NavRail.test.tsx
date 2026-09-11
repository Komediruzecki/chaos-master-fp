import { cleanup, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavRail } from './NavRail'
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

function mount(current: ShellDestination = 'create') {
  const onSelect = vi.fn()
  const onOpenSettings = vi.fn()
  render(() => (
    <NavRail
      current={() => current}
      onSelect={onSelect}
      onOpenSettings={onOpenSettings}
    />
  ))
  return { onSelect, onOpenSettings }
}

describe('NavRail', () => {
  beforeEach(() => {
    selectionChanged.mockClear()
  })
  afterEach(cleanup)

  it('carries the destinations and Settings, and marks where you are', () => {
    const { onSelect, onOpenSettings } = mount('create')
    expect(
      screen.getByRole('navigation', { name: 'Destinations' }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Create' })
        .getAttribute('aria-current'),
    ).toBe('page')

    const library = screen.getByRole('button', { name: 'Library' })
    expect(library.getAttribute('aria-current')).toBeNull()
    library.click()
    expect(onSelect).toHaveBeenCalledWith('library')
    expect(selectionChanged).toHaveBeenCalledTimes(1)

    // Settings is not a destination: it opens over whatever you were doing.
    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(settings.getAttribute('aria-current')).toBeNull()
    settings.click()
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
