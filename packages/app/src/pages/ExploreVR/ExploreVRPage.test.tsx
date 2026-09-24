/**
 * Desktop atlas user journeys with GPU and star rendering replaced by stubs.
 * Exercises navigation, render controls, links, and persistent discoveries;
 * device output and performance are verified separately in a real browser.
 */
import { cleanup, fireEvent, render, screen, within, } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExploreVRPage } from './ExploreVRPage'
import type { FlameOrbProps } from './FlameOrb'

const stubs = vi.hoisted(() => ({ renderers: [] as FlameOrbProps[] }))

vi.mock('./FlameOrb', () => ({
  FlameOrb: (props: FlameOrbProps) => {
    stubs.renderers.push(props)
    return null
  },
}))

vi.mock('./AtlasStars', () => ({ AtlasStars: () => null }))

// The runner's localStorage is not a working Storage; retain this store across
// remounts to exercise the same saved-data boundary as reopening the page.
const stored = new Map<string, string>()
const memoryStorage: Storage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => {
    stored.set(key, value)
  },
  removeItem: (key) => {
    stored.delete(key)
  },
  clear: () => {
    stored.clear()
  },
  key: (index) => [...stored.keys()][index] ?? null,
  get length() {
    return stored.size
  },
}

beforeEach(() => {
  stored.clear()
  stubs.renderers.length = 0
  vi.stubGlobal('localStorage', memoryStorage)
  window.history.replaceState(null, '', '/explore-vr')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function open(hash = '') {
  window.history.replaceState(null, '', `/explore-vr${hash}`)
  return render(() => <ExploreVRPage />)
}

function renderer() {
  const props = stubs.renderers.at(-1)
  if (!props) throw new Error('The atlas did not mount its flame renderer')
  return props
}

function itineraryWorld(name: string) {
  return within(
    screen.getByRole('region', { name: 'Choose a world' }),
  ).getByRole('button', { name: (label) => label.includes(name) })
}

describe('ExploreVRPage navigation', () => {
  it('selects the same flame and link from its satellite or itinerary entry', () => {
    open('#sol')

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Ember' }))
    const satellitePreset = renderer().preset
    expect(satellitePreset.id).toBe('ember')
    expect(window.location.hash).toBe('#ember')
    expect(screen.getByRole('heading', { name: 'Ember' })).toBeTruthy()
    expect(itineraryWorld('Ember').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Tide' }))
    expect(renderer().preset.id).toBe('tide')
    fireEvent.click(itineraryWorld('Ember'))

    expect(renderer().preset).toBe(satellitePreset)
    expect(window.location.hash).toBe('#ember')
    expect(screen.getByRole('heading', { name: 'Ember' })).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Inspect Ember' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Inspect Tide' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it.each(['', '#unknown-world'])(
    'opens the default world for an empty or unknown link (%s)',
    (hash) => {
      open(hash)

      expect(renderer().preset.id).toBe('verdant')
      expect(screen.getByRole('heading', { name: 'Verdant' })).toBeTruthy()
      expect(itineraryWorld('Verdant').getAttribute('aria-pressed')).toBe(
        'true',
      )
    },
  )

  it('follows changed links and recovers to the default world from an unknown destination', () => {
    open('#sol')
    window.history.replaceState(null, '', '#tide')
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(renderer().preset.id).toBe('tide')
    expect(screen.getByRole('heading', { name: 'Tide' })).toBeTruthy()
    expect(itineraryWorld('Tide').getAttribute('aria-pressed')).toBe('true')

    window.history.replaceState(null, '', '#unknown-world')
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(renderer().preset.id).toBe('verdant')
    expect(screen.getByRole('heading', { name: 'Verdant' })).toBeTruthy()
    expect(itineraryWorld('Tide').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('ExploreVRPage render controls', () => {
  it('pauses and resumes rendering, then resets the same world in a running state', () => {
    open('#ember')
    const flame = renderer()
    const preset = flame.preset

    fireEvent.click(screen.getByRole('button', { name: 'Pause rendering' }))
    expect(flame.paused).toBe(true)
    expect(screen.getByText('Rendering paused')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Resume rendering' })
        .getAttribute('aria-pressed'),
    ).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Resume rendering' }))
    expect(flame.paused).toBe(false)
    expect(
      screen
        .getByRole('button', { name: 'Pause rendering' })
        .getAttribute('aria-pressed'),
    ).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Pause rendering' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))

    expect(flame.paused).toBe(false)
    expect(flame.resetKey).toBe(1)
    expect(flame.preset).toBe(preset)
    expect(window.location.hash).toBe('#ember')
    expect(
      screen.queryByRole('button', { name: 'Resume rendering' }),
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(flame.resetKey).toBe(2)
  })

  it('starts a newly selected world even when the previous one was paused', () => {
    open('#sol')
    fireEvent.click(screen.getByRole('button', { name: 'Pause rendering' }))
    fireEvent.click(itineraryWorld('Tide'))

    expect(renderer().preset.id).toBe('tide')
    expect(renderer().paused).toBe(false)
    expect(screen.getByRole('button', { name: 'Pause rendering' })).toBeTruthy()
    expect(window.location.hash).toBe('#tide')
  })
})

describe('ExploreVRPage discoveries', () => {
  it('restores saved worlds after reopening and persists removing a discovery', () => {
    const firstVisit = open('#sol')
    fireEvent.click(screen.getByRole('button', { name: 'Keep this discovery' }))
    fireEvent.click(itineraryWorld('Ember'))
    fireEvent.click(screen.getByRole('button', { name: 'Keep this discovery' }))
    expect(screen.getByText('2 / 5 discovered')).toBeTruthy()

    firstVisit.unmount()
    const nextVisit = open(window.location.hash)
    expect(screen.getByRole('heading', { name: 'Ember' })).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Discovered' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByText('2 / 5 discovered')).toBeTruthy()
    fireEvent.click(itineraryWorld('Sol'))
    fireEvent.click(screen.getByRole('button', { name: 'Discovered' }))
    expect(screen.getByText('Sol removed from your discoveries.')).toBeTruthy()
    expect(screen.getByText('1 / 5 discovered')).toBeTruthy()

    nextVisit.unmount()
    open(window.location.hash)
    expect(screen.getByRole('heading', { name: 'Sol' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Keep this discovery' }),
    ).toBeTruthy()
    expect(screen.getByText('1 / 5 discovered')).toBeTruthy()
    fireEvent.click(itineraryWorld('Ember'))
    expect(screen.getByRole('button', { name: 'Discovered' })).toBeTruthy()
  })

  it('keeps discoveries usable for this visit when storage reads and writes are denied', () => {
    vi.spyOn(memoryStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError')
    })
    vi.spyOn(memoryStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError')
    })
    const visit = open('#sol')
    expect(screen.getByText('0 / 5 discovered')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Keep this discovery' }))
    expect(screen.getByRole('button', { name: 'Discovered' })).toBeTruthy()
    expect(screen.getByText('1 / 5 discovered')).toBeTruthy()
    expect(
      screen.getByText(
        'Storage is unavailable. Your discoveries will last for this visit.',
      ),
    ).toBeTruthy()

    fireEvent.click(itineraryWorld('Tide'))
    fireEvent.click(itineraryWorld('Sol'))
    expect(screen.getByRole('button', { name: 'Discovered' })).toBeTruthy()

    visit.unmount()
    open('#sol')
    expect(
      screen.getByRole('button', { name: 'Keep this discovery' }),
    ).toBeTruthy()
    expect(screen.getByText('0 / 5 discovered')).toBeTruthy()
  })
})
