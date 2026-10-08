import { cleanup, fireEvent, render, screen, waitFor, } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setActiveTab } from '@/lib/activeTab'
import { ArcadeHub } from './ArcadeHub'

vi.mock('@/pages/GummyBoard/GummyMatchPage', () => ({
  GummyMatchPage: (props: { onBackToArcade: () => void }) => (
    <section aria-label="Chess world">
      <button onClick={props.onBackToArcade}>Back to Arcade</button>
    </section>
  ),
}))

describe('the Arcade hub', () => {
  afterEach(() => {
    cleanup()
    setActiveTab('workspace')
  })

  it('opens chess without an agent connection and returns to the hub', async () => {
    setActiveTab('arcade')
    render(() => <ArcadeHub onBackToEditor={vi.fn()} />)
    fireEvent.click(screen.getByTestId('arcade-chess'))
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Chess world' })).toBeTruthy()
    })
    expect(window.location.hash).toBe('#arcade=chess')
    expect(screen.queryByRole('heading', { name: 'Lumen Arcade' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Arcade' }))
    expect(window.location.hash).toBe('#arcade')
    expect(screen.getByRole('heading', { name: 'Lumen Arcade' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Chess world' })).toBeNull()
  })

  it('opens a direct chess fragment without mounting the mode panel', async () => {
    setActiveTab('arcade', 'chess')
    render(() => <ArcadeHub onBackToEditor={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Chess world' })).toBeTruthy()
    })
    expect(screen.queryByTestId('arcade-card')).toBeNull()
    const consumed = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    consumed.preventDefault()
    document.dispatchEvent(consumed)
    expect(window.location.hash).toBe('#arcade=chess')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(window.location.hash).toBe('#arcade')
  })

  it('offers a way out that does not need scrolling', () => {
    // The footer button sits below the whole card grid. Escape covers a
    // keyboard, and a tablet has none - so the hub carries a back control of
    // its own, pinned where it cannot leave with the scroll.
    const onBackToEditor = vi.fn()
    render(() => <ArcadeHub onBackToEditor={onBackToEditor} />)

    const back = screen.getByTestId('arcade-back')
    expect(back.getAttribute('aria-label')).toBe('Back to editor')

    fireEvent.click(back)
    expect(onBackToEditor).toHaveBeenCalledTimes(1)
  })

  it('keeps the footer button, the natural end-of-page action', () => {
    // Removing it would be a regression for anyone who has scrolled to read
    // the cards and wants out from where they are.
    const onBackToEditor = vi.fn()
    render(() => <ArcadeHub onBackToEditor={onBackToEditor} />)

    // By its text, not its role and name: the pinned control above answers to
    // the same name through its aria-label.
    fireEvent.click(screen.getByText('Back to editor'))
    expect(onBackToEditor).toHaveBeenCalledTimes(1)
  })
})
