/**
 * Fullscreen atlas journeys with the spatial stage replaced at its public
 * boundary. Exercises navigation, optional touring, motion preferences and
 * persistence; actual camera travel and GPU output need separate verification.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExploreVRPage } from './ExploreVRPage'
import type { ImmersiveAtlasProps } from './ImmersiveAtlas'

const stubs = vi.hoisted(() => ({ scenes: [] as ImmersiveAtlasProps[] }))

vi.mock('./ImmersiveAtlas', async () => {
  const { ORB_PRESETS } = await import('./orbPresets')
  return {
    ImmersiveAtlas: (props: ImmersiveAtlasProps) => {
      stubs.scenes.push(props)
      return (
        <div>
          <canvas role="img" aria-label="Live flame controls" tabIndex={0} />
          {ORB_PRESETS.map((orb) => (
            <button
              onClick={() => {
                props.onSelect(orb)
              }}
              aria-label={`Inspect ${orb.name}`}
              aria-pressed={props.preset.id === orb.id}
            >
              {orb.name}
            </button>
          ))}
        </div>
      )
    },
  }
})

const LOG_KEY = 'chaos-master-fractal-atlas-discoveries-v1'
// Retain storage across remounts to exercise reopening the atlas. The runner's
// default localStorage is not a working Storage implementation.
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
let motion: MediaQueryList
let reduced = false
let hidden = false

beforeEach(() => {
  stored.clear()
  stubs.scenes.length = 0
  reduced = false
  hidden = false
  const target = new EventTarget()
  Object.defineProperties(target, {
    matches: { get: () => reduced },
    media: { value: '(prefers-reduced-motion: reduce)' },
  })
  motion = target as MediaQueryList
  vi.stubGlobal('localStorage', memoryStorage)
  vi.stubGlobal('matchMedia', () => motion)
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.useFakeTimers()
  window.history.replaceState(null, '', '/explore-vr')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function open(hash = '') {
  window.history.replaceState(null, '', `/explore-vr${hash}`)
  return render(() => <ExploreVRPage />)
}

function scene() {
  const props = stubs.scenes.at(-1)
  if (!props) throw new Error('The atlas did not mount its spatial stage')
  return props
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function details() {
  click('Inspect world details')
}

function setHidden(value: boolean) {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('ExploreVRPage navigation and inspection', () => {
  it('keeps details closed until requested and restores focus when dismissed', () => {
    open('#sol')
    const inspect = screen.getByRole('button', {
      name: 'Inspect world details',
    })
    expect(inspect.getAttribute('aria-expanded')).toBe('false')
    expect(
      screen.queryByRole('complementary', { name: 'World details' }),
    ).toBeNull()
    details()
    expect(
      screen.getByRole('complementary', { name: 'World details' }),
    ).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(
      screen.queryByRole('complementary', { name: 'World details' }),
    ).toBeNull()
    expect(document.activeElement).toBe(inspect)
  })

  it('selects the same destination from a satellite or route and wraps previous/next', () => {
    open('#sol')
    click('Inspect Ember')
    const ember = scene().preset
    expect(window.location.hash).toBe('#ember')
    expect(screen.getByRole('heading', { name: 'Ember' })).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Travel to Ember' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    click('Travel to Sol')
    click('Previous world')
    expect(scene().preset.id).toBe('irchiinnuss')
    click('Next world')
    expect(scene().preset.id).toBe('sol')
    click('Travel to Ember')
    expect(scene().preset).toBe(ember)
    expect(screen.getByText('Selected world: Ember')).toBeTruthy()
  })

  it.each(['', '#unknown-world'])(
    'opens the default destination for %s',
    (hash) => {
      open(hash)
      expect(scene().preset.id).toBe('verdant')
      expect(screen.getByRole('heading', { name: 'Verdant' })).toBeTruthy()
    },
  )

  it('follows changed hashes, ends a journey and recovers from unknown destinations', () => {
    open('#sol')
    click('Start guided journey')
    window.history.replaceState(null, '', '#tide')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(scene().preset.id).toBe('tide')
    expect(
      screen.getByRole('button', { name: 'Start guided journey' }),
    ).toBeTruthy()
    window.history.replaceState(null, '', '#missing')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(scene().preset.id).toBe('verdant')
    expect(window.location.hash).toBe('#verdant')
  })
})

describe('ExploreVRPage scene controls', () => {
  it('preserves pause across selection and reset, until explicitly resumed', () => {
    open('#ember')
    click('Pause scene')
    click('Travel to Tide')
    details()
    click('Reset view')
    expect(scene().paused).toBe(true)
    expect(scene().resetKey).toBe(1)
    expect(scene().preset.id).toBe('tide')
    expect(screen.getByText('Scene paused')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zoom in' }).disabled).toBe(true)
    click('Resume scene')
    click('Zoom in')
    click('Zoom in')
    click('Zoom out')
    expect(scene().paused).toBe(false)
    expect(scene().zoomStep).toBe(1)
  })

  it('resets readiness on selection and keeps navigation usable after GPU failure', () => {
    open('#sol')
    scene().onReady()
    expect(screen.getByText('Live 3D flame')).toBeTruthy()
    click('Travel to Ember')
    expect(scene().ready).toBe(false)
    expect(screen.getByText('Forming the flame…')).toBeTruthy()
    scene().onError('Adapter unavailable')
    click('Travel to Tide')
    expect(screen.getByRole('heading', { name: 'Tide' })).toBeTruthy()
    expect(screen.getByText('Captured world')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload renderer' })).toBeTruthy()
    details()
    expect(screen.getByRole('button', { name: 'Reset view' }).disabled).toBe(
      true,
    )
    click('Keep this discovery')
    expect(screen.getByRole('button', { name: 'Discovered' })).toBeTruthy()
  })

  it('uses the initial motion preference and responds to preference changes without starting a tour', () => {
    reduced = true
    open('#sol')
    expect(scene().reducedMotion).toBe(true)
    reduced = false
    motion.dispatchEvent(new Event('change'))
    expect(scene().reducedMotion).toBe(false)
    reduced = true
    motion.dispatchEvent(new Event('change'))
    expect(scene().reducedMotion).toBe(true)
    vi.advanceTimersByTime(30_000)
    expect(scene().preset.id).toBe('sol')
    expect(
      screen.getByRole('button', { name: 'Start guided journey' }),
    ).toBeTruthy()
  })

  it.each([false, true])(
    'explains fullscreen refusal and leaves navigation working (API present: %s)',
    async (available) => {
      open('#sol')
      Object.defineProperty(screen.getByRole('main'), 'requestFullscreen', {
        configurable: true,
        value: available
          ? () => Promise.reject(new DOMException('Denied', 'NotAllowedError'))
          : undefined,
      })
      click('Enter fullscreen')
      await Promise.resolve()
      expect(
        screen.getByText(
          available
            ? 'Fullscreen could not start. You can continue exploring in this window.'
            : 'Fullscreen is unavailable in this browser. The atlas already fills this window.',
        ),
      ).toBeTruthy()
      click('Next world')
      expect(scene().preset.id).toBe('verdant')
    },
  )
})

describe('ExploreVRPage guided journey', () => {
  it('cancels the old dwell when a journey is ended and restarted', () => {
    open('#sol')
    click('Start guided journey')
    vi.advanceTimersByTime(8000)
    click('End guided journey')
    vi.advanceTimersByTime(20_000)
    expect(scene().preset.id).toBe('sol')
    click('Start guided journey')
    vi.advanceTimersByTime(8000)
    click('End guided journey')
    click('Start guided journey')
    vi.advanceTimersByTime(8999)
    expect(scene().preset.id).toBe('sol')
    vi.advanceTimersByTime(1)
    expect(scene().preset.id).toBe('verdant')
  })

  it('starts explicitly, resumes a paused scene and waits nine settled seconds between worlds', () => {
    open('#sol')
    vi.advanceTimersByTime(30_000)
    expect(scene().preset.id).toBe('sol')
    click('Pause scene')
    click('Start guided journey')
    expect(scene().paused).toBe(false)
    scene().onTravelChange?.(true)
    vi.advanceTimersByTime(20_000)
    expect(scene().preset.id).toBe('sol')
    scene().onTravelChange?.(false)
    vi.advanceTimersByTime(8999)
    expect(scene().preset.id).toBe('sol')
    vi.advanceTimersByTime(1)
    expect(scene().preset.id).toBe('verdant')
    expect(
      screen.getByRole('button', { name: 'End guided journey' }),
    ).toBeTruthy()
  })

  it('starts a fresh dwell after pausing or returning from a hidden tab', () => {
    open('#sol')
    click('Start guided journey')
    vi.advanceTimersByTime(8000)
    click('Pause scene')
    vi.advanceTimersByTime(30_000)
    expect(scene().preset.id).toBe('sol')
    click('Resume scene')
    vi.advanceTimersByTime(8000)
    setHidden(true)
    vi.advanceTimersByTime(30_000)
    expect(scene().preset.id).toBe('sol')
    setHidden(false)
    vi.advanceTimersByTime(8999)
    expect(scene().preset.id).toBe('sol')
    vi.advanceTimersByTime(1)
    expect(scene().preset.id).toBe('verdant')
  })

  it.each([
    'satellite',
    'same destination',
    'next',
    'pointer',
    'keyboard',
    'wheel',
    'zoom',
    'reset',
  ])('ends the journey after manual %s interaction', (action) => {
    open('#sol')
    details()
    click('Start guided journey')
    const canvas = screen.getByRole('img', { name: 'Live flame controls' })
    if (action === 'satellite') click('Inspect Ember')
    if (action === 'same destination') click('Travel to Sol')
    if (action === 'next') click('Next world')
    if (action === 'pointer') fireEvent.pointerDown(canvas)
    if (action === 'keyboard') fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    if (action === 'wheel') fireEvent.wheel(canvas, { deltaY: 120 })
    if (action === 'zoom') click('Zoom in')
    if (action === 'reset') click('Reset view')
    const destination = scene().preset.id
    expect(
      screen.getByRole('button', { name: 'Start guided journey' }),
    ).toBeTruthy()
    vi.advanceTimersByTime(30_000)
    expect(scene().preset.id).toBe(destination)
  })

  it('cancels pending work on unmount and restores the original title', () => {
    const title = document.title
    const visit = open('#sol')
    const stage = scene()
    click('Start guided journey')
    vi.advanceTimersByTime(8999)
    visit.unmount()
    reduced = true
    motion.dispatchEvent(new Event('change'))
    window.history.replaceState(null, '', '#tide')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    vi.advanceTimersByTime(30_000)
    expect(document.title).toBe(title)
    expect(stage.reducedMotion).toBe(false)
    expect(stage.preset.id).toBe('sol')
    expect(window.location.hash).toBe('#tide')
  })
})

describe('ExploreVRPage discoveries', () => {
  it('restores saved worlds after reopening and persists removing a discovery', () => {
    const first = open('#sol')
    details()
    click('Keep this discovery')
    click('Travel to Ember')
    click('Keep this discovery')
    expect(screen.getByText('2 of 5 worlds kept')).toBeTruthy()
    first.unmount()
    const second = open('#sol')
    details()
    click('Discovered')
    expect(screen.getByText('Sol removed from your discoveries.')).toBeTruthy()
    second.unmount()
    open('#sol')
    details()
    expect(
      screen.getByRole('button', { name: 'Keep this discovery' }),
    ).toBeTruthy()
    expect(screen.getByText('1 of 5 worlds kept')).toBeTruthy()
    click('Travel to Ember')
    expect(screen.getByRole('button', { name: 'Discovered' })).toBeTruthy()
  })

  it.each([
    ['{', 0],
    ['{}', 0],
    ['["sol","sol","missing",7]', 1],
  ])('recovers safely from stored data %s', (value, count) => {
    stored.set(LOG_KEY, value)
    open('#sol')
    expect(screen.getByText(`${count} of 5 worlds kept`)).toBeTruthy()
  })

  it('keeps discoveries usable for this visit when storage is denied', () => {
    vi.spyOn(memoryStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError')
    })
    vi.spyOn(memoryStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError')
    })
    const visit = open('#sol')
    details()
    click('Keep this discovery')
    expect(
      screen.getByText(
        'Storage is unavailable. Your discoveries will last for this visit.',
      ),
    ).toBeTruthy()
    click('Travel to Tide')
    click('Travel to Sol')
    expect(screen.getByRole('button', { name: 'Discovered' })).toBeTruthy()
    visit.unmount()
    open('#sol')
    expect(screen.getByText('0 of 5 worlds kept')).toBeTruthy()
  })
})
