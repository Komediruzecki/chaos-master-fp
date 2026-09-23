/**
 * The tour's glass (docs/plans/glass-panels.md, phase 1).
 *
 * The four scrims around the highlighted element animate their size on
 * every step, so a blur of their own re-ran on every frame of the move, under
 * a card that blurred as well. They are a dim now, and the card is the one
 * glass layer: the primitive's panel in the dark theme and on the touch
 * layouts. The desktop's light theme keeps its light card, as the glass is
 * dark-only (decision b). The test DOM applies no CSS, so this holds the
 * inline styles and the class the stylesheet keys on.
 */
import { cleanup, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { createSpotlightTourState, SpotlightTourContext, } from '@/contexts/SpotlightTourContext'
import { ThemeContextProvider, useTheme } from '@/contexts/ThemeContext'
import { setTouchLayoutPreference } from '@/stores/workspaceLayoutStore'
import { SpotlightTour } from './SpotlightTour'
import type { TourContext, TourGuide } from './tourTypes'
import type { Theme } from '@/contexts/ThemeContext'

const TOUR: TourGuide = {
  id: 'glass-test',
  name: 'Glass test',
  description: '',
  steps: [
    { target: 'body', title: 'One', description: 'The first step' },
    { target: 'body', title: 'Two', description: 'The second step' },
  ],
}

function ThemeIs(props: { theme: Theme }) {
  useTheme().setTheme(props.theme)
  return null
}

function mountTour(theme: Theme = 'dark') {
  const tour = createSpotlightTourState(() => TOUR)
  const tourContext = {
    finishAllAnimations: () => {},
    snapshotFlame: () => ({}),
    restoreFlame: () => {},
  } as unknown as TourContext
  render(() => (
    <ThemeContextProvider>
      <ThemeIs theme={theme} />
      <SpotlightTourContext.Provider value={tour}>
        <SpotlightTour tourContext={tourContext} />
      </SpotlightTourContext.Provider>
    </ThemeContextProvider>
  ))
  tour.startTour(TOUR.id)
  return tour
}

/** The dim around the hole: fixed boxes that carry a background inline. */
function scrims(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('div')].filter(
    (el) => el.style.position === 'fixed' && el.style.background !== '',
  )
}

const card = () => screen.getByRole('dialog', { name: 'One' })

afterEach(() => {
  cleanup()
  setTouchLayoutPreference('auto')
})

describe('the tour on glass', () => {
  it('dims around the target without a blur of its own', () => {
    mountTour()

    expect(scrims()).toHaveLength(4)
    for (const scrim of scrims()) {
      expect(scrim.style.getPropertyValue('backdrop-filter')).toBe('')
      expect(scrim.style.getPropertyValue('-webkit-backdrop-filter')).toBe('')
    }
  })

  it('makes the card glass in the dark theme', () => {
    mountTour('dark')

    expect(card().classList.contains('glassCard')).toBe(true)
  })

  it('keeps the light card on the desktop in the light theme', () => {
    setTouchLayoutPreference('desktop')
    mountTour('light')

    expect(card().classList.contains('glassCard')).toBe(false)
  })

  it('makes the card glass on a touch layout in the light theme too', () => {
    setTouchLayoutPreference('touch')
    mountTour('light')

    expect(card().classList.contains('glassCard')).toBe(true)
  })
})
