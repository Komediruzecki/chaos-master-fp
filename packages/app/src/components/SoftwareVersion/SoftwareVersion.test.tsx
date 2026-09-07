import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SoftwareVersion } from './SoftwareVersion'

describe('SoftwareVersion component', () => {
  afterEach(cleanup)

  it('renders collapsed trigger and expands upward menu on click', () => {
    const showHelp = vi.fn()
    const showDocs = vi.fn()
    const showBenchmark = vi.fn()
    const setPref = vi.fn()

    render(() => (
      <SoftwareVersion
        showHelp={showHelp}
        showDocs={showDocs}
        showBenchmark={showBenchmark}
        touchLayoutPreference={() => 'desktop'}
        setTouchLayoutPreference={setPref}
        isTouchLayout={() => false}
      />
    ))

    const trigger = screen.getByRole('button', { name: /chaos master menu/i })
    expect(trigger).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()

    // Open menu
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByText('Switch to Touch Studio')).toBeTruthy()
    expect(screen.getByText('Lumen Arcade')).toBeTruthy()
    expect(screen.getByText('Benchmark Lab')).toBeTruthy()
    expect(screen.getByText('Quick GPU Benchmark')).toBeTruthy()
    expect(screen.getByText('Documentation')).toBeTruthy()
    expect(screen.getByText('About Chaos Master')).toBeTruthy()

    // Test switch to touch layout
    screen.getByText('Switch to Touch Studio').click()
    expect(setPref).toHaveBeenCalledWith('touch')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('switches to desktop layout when in touch mode', () => {
    const setPref = vi.fn()

    render(() => (
      <SoftwareVersion
        showHelp={vi.fn()}
        showDocs={vi.fn()}
        showBenchmark={vi.fn()}
        touchLayoutPreference={() => 'touch'}
        setTouchLayoutPreference={setPref}
        isTouchLayout={() => true}
      />
    ))

    const trigger = screen.getByRole('button', { name: /chaos master menu/i })
    fireEvent.click(trigger)
    expect(screen.getByText('Switch to Desktop Layout')).toBeTruthy()

    screen.getByText('Switch to Desktop Layout').click()
    expect(setPref).toHaveBeenCalledWith('desktop')
  })

  it('triggers quick benchmark, docs, and help from menu', () => {
    const showHelp = vi.fn()
    const showDocs = vi.fn()
    const showBenchmark = vi.fn()

    render(() => (
      <SoftwareVersion
        showHelp={showHelp}
        showDocs={showDocs}
        showBenchmark={showBenchmark}
      />
    ))

    const trigger = screen.getByRole('button', { name: /chaos master menu/i })

    // Benchmark
    fireEvent.click(trigger)
    screen.getByText('Quick GPU Benchmark').click()
    expect(showBenchmark).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()

    // Docs
    fireEvent.click(trigger)
    screen.getByText('Documentation').click()
    expect(showDocs).toHaveBeenCalled()

    // Help
    fireEvent.click(trigger)
    screen.getByText('About Chaos Master').click()
    expect(showHelp).toHaveBeenCalled()
  })

  it('closes menu on Escape key', () => {
    render(() => (
      <SoftwareVersion
        showHelp={vi.fn()}
        showDocs={vi.fn()}
        showBenchmark={vi.fn()}
      />
    ))

    const trigger = screen.getByRole('button', { name: /chaos master menu/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
