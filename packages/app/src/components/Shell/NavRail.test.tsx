import { cleanup, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backDepth, popBack } from '@/lib/backStack'
import { haptic } from '@/lib/haptics'
import { NavRail } from './NavRail'
import { ShellBar } from './ShellBar'
import type { MoreMenuHandlers } from './moreMenu'
import type { ShellDestination } from './ShellBar'

// The real module is safe to call here: every method delegates to NO_HAPTICS
// until the native ports load, which they never do on the web. Restating all
// eight as a mock only created a second copy to keep in step with the module.
const selectionChanged = vi.spyOn(haptic, 'selectionChanged')

/** Everything MainWorkspace can offer the editor's shells. */
const HANDLERS: MoreMenuHandlers = {
  onOpenExportModal: vi.fn(),
  onShare: vi.fn(),
  onOpenDrawer: vi.fn(),
  onOpenDocs: vi.fn(),
  onOpenBenchmark: vi.fn(),
  onOpenBenchmarkLab: vi.fn(),
  onOpenSettings: vi.fn(),
  onDesktopLayout: vi.fn(),
}

function mount(current: ShellDestination = 'create', more?: MoreMenuHandlers) {
  const onSelect = vi.fn()
  const onOpenSettings = vi.fn()
  render(() => (
    <NavRail
      current={() => current}
      onSelect={onSelect}
      onOpenSettings={onOpenSettings}
      more={more}
    />
  ))
  return { onSelect, onOpenSettings }
}

/** The labels the open More list shows, in order. */
function moreLabels() {
  screen.getByRole('button', { name: 'More' }).click()
  return screen.getAllByRole('menuitem').map((item) => item.textContent)
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

  it('mounts its menu layer only while the menu is open', () => {
    // The layer is fixed across the whole viewport at --la-z-shell, and it
    // used to be mounted for the life of the deck layout: over the app the
    // whole time, harmless only because it sets pointer-events: none.
    mount('library', HANDLERS)
    expect(screen.queryByTestId('navrail-more-layer')).toBeNull()

    screen.getByRole('button', { name: 'More' }).click()
    expect(screen.getByTestId('navrail-more-layer')).toBeTruthy()

    screen.getByTestId('navrail-more-backdrop').click()
    expect(screen.queryByTestId('navrail-more-layer')).toBeNull()
  })

  it('offers the same More list the phone bar offers', () => {
    // This layout mounts no phone bar, and the editor's top bar is behind
    // Home, so before this the rail was the only shell on a landscape tablet
    // and it carried two destinations and Settings: Library reached none of
    // the list below until you went back to Create.
    mount('library', HANDLERS)
    const railList = moreLabels()
    cleanup()

    render(() => (
      <ShellBar
        mode="full"
        current={() => 'library'}
        onSelect={vi.fn()}
        more={HANDLERS}
      />
    ))
    expect(railList).toEqual(moreLabels())
    expect(railList).toContain('Lumen Arcade')
    expect(railList).toContain('Share link')
    expect(railList).toContain('Export options')
  })

  it('runs what was chosen, and closes from the backdrop and from back', () => {
    mount('library', HANDLERS)
    moreLabels()
    expect(backDepth()).toBe(1)

    screen.getByTestId('navrail-more-backdrop').click()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(backDepth()).toBe(0)

    moreLabels()
    expect(popBack()).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()

    moreLabels()
    screen.getByText('Share link').click()
    expect(HANDLERS.onShare).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
