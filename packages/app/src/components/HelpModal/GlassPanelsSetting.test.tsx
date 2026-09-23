/**
 * The Glass panels row in Settings: offered on the touch layouts only, and
 * the one place a user turns the setting on or off.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { glassPanels, setGlassPanels } from '@/lib/glass'
import { GlassPanelsSetting } from './GlassPanelsSetting'

const [touch, setTouch] = createSignal(true)

vi.mock('@/stores/workspaceLayoutStore', () => ({
  isTouchLayout: () => touch(),
}))

const LABEL = 'Glass panels (experimental)'

describe('the Glass panels setting row', () => {
  afterEach(() => {
    cleanup()
    setGlassPanels(false)
    setTouch(true)
  })

  it('offers the setting with its cost on a touch layout', () => {
    render(() => <GlassPanelsSetting />)

    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: LABEL })
    expect(box.checked).toBe(false)
    expect(
      screen.getByText('May lower the frame rate on older devices.'),
    ).toBeTruthy()
  })

  it('is not offered on the desktop layout, where it changes nothing', () => {
    setTouch(false)
    render(() => <GlassPanelsSetting />)

    expect(screen.queryByRole('checkbox', { name: LABEL })).toBeNull()
  })

  it('turns the setting on and off, and <html> follows', () => {
    render(() => <GlassPanelsSetting />)
    const box = screen.getByRole('checkbox', { name: LABEL })

    fireEvent.click(box)
    expect(glassPanels()).toBe(true)
    expect(document.documentElement.getAttribute('data-glass-panels')).toBe(
      'on',
    )

    fireEvent.click(box)
    expect(glassPanels()).toBe(false)
    expect(document.documentElement.hasAttribute('data-glass-panels')).toBe(
      false,
    )
  })

  it('shows a setting turned on elsewhere as checked', () => {
    setGlassPanels(true)
    render(() => <GlassPanelsSetting />)

    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: LABEL })
    expect(box.checked).toBe(true)
  })
})
