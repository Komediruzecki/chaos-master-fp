/**
 * The Glass panels row in Settings: on by default, offered on every layout,
 * and the one place a user turns the setting off or back on.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { glassPanels, setGlassPanels } from '@/lib/glass'
import { GlassPanelsSetting } from './GlassPanelsSetting'

const LABEL = 'Glass panels'

describe('the Glass panels setting row', () => {
  afterEach(() => {
    cleanup()
    setGlassPanels(true)
  })

  it('offers the setting, on, with what turning it off buys', () => {
    render(() => <GlassPanelsSetting />)

    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: LABEL })
    expect(box.checked).toBe(true)
    expect(
      screen.getByText(
        'Frosted glass over the artwork. Turn it off if the frame rate drops.',
      ),
    ).toBeTruthy()
  })

  it('turns the setting off and on, and <html> follows', () => {
    render(() => <GlassPanelsSetting />)
    const box = screen.getByRole('checkbox', { name: LABEL })

    fireEvent.click(box)
    expect(glassPanels()).toBe(false)
    expect(document.documentElement.hasAttribute('data-glass-panels')).toBe(
      false,
    )

    fireEvent.click(box)
    expect(glassPanels()).toBe(true)
    expect(document.documentElement.getAttribute('data-glass-panels')).toBe(
      'on',
    )
  })

  it('shows a setting turned off elsewhere as unchecked', () => {
    setGlassPanels(false)
    render(() => <GlassPanelsSetting />)

    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: LABEL })
    expect(box.checked).toBe(false)
  })
})
