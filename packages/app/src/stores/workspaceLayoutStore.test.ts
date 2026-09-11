import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { classifyLayout, createWorkspaceLayoutStore, deckFits, deckFitsWidth, isTouchLayout, isWideLayout, WIDE_LAYOUT_MIN_WIDTH, } from './workspaceLayoutStore'

/** The store derives its class from one resize listener, so tests drive that. */
function resizeTo(width: number, height: number) {
  window.innerWidth = width
  window.innerHeight = height
  window.dispatchEvent(new Event('resize'))
}

const touch = (width: number, height: number) =>
  classifyLayout({
    width,
    height,
    coarse: true,
    native: true,
    preference: 'auto',
  })

describe('classifyLayout on a device', () => {
  it.each([
    [393, 852, 'phone', false],
    [852, 393, 'phone', false],
    [412, 915, 'phone', false],
    [455, 1210, 'phone', false],
    [834, 1210, 'tablet', false],
    [1210, 834, 'tablet', true],
    [800, 1280, 'tablet', false],
    [1280, 800, 'tablet', true],
    [1024, 1366, 'tablet', true],
    [1366, 1024, 'tablet', true],
  ])('%i x %i is %s, deck %s', (width, height, expected, deck) => {
    expect(touch(width, height)).toBe(expected)
    expect(deckFitsWidth(width)).toBe(deck)
  })

  it('never returns desktop while native', () => {
    for (const width of [680, 900, 1024, 1366, 2000]) {
      expect(
        classifyLayout({
          width,
          height: 1000,
          coarse: false,
          native: true,
          preference: 'auto',
        }),
      ).not.toBe('desktop')
    }
  })
})

describe('classifyLayout on the web', () => {
  const web = (width: number, height: number) =>
    classifyLayout({
      width,
      height,
      coarse: false,
      native: false,
      preference: 'auto',
    })

  it('keeps the width rules for a fine pointer', () => {
    expect(web(600, 900)).toBe('phone')
    expect(web(900, 700)).toBe('tablet')
    expect(web(1024, 700)).toBe('tablet')
    expect(web(1025, 700)).toBe('desktop')
    expect(web(1440, 900)).toBe('desktop')
  })

  it('treats a coarse pointer like a device', () => {
    expect(
      classifyLayout({
        width: 1280,
        height: 800,
        coarse: true,
        native: false,
        preference: 'auto',
      }),
    ).toBe('tablet')
  })

  it('honours the preference', () => {
    expect(
      classifyLayout({
        width: 393,
        height: 852,
        coarse: true,
        native: true,
        preference: 'desktop',
      }),
    ).toBe('desktop')
    expect(
      classifyLayout({
        width: 1440,
        height: 900,
        coarse: false,
        native: false,
        preference: 'touch',
      }),
    ).toBe('tablet')
    expect(
      classifyLayout({
        width: 500,
        height: 900,
        coarse: false,
        native: false,
        preference: 'touch',
      }),
    ).toBe('phone')
  })
})

describe('workspaceLayoutStore', () => {
  it('respects wide layout parameter on initialization', () => {
    createRoot((dispose) => {
      const wideStore = createWorkspaceLayoutStore(true)
      expect(wideStore.sidebarHidden()).toBe(false)
      expect(wideStore.showTimeline()).toBe(true)

      const narrowStore = createWorkspaceLayoutStore(false)
      expect(narrowStore.sidebarHidden()).toBe(true)
      expect(narrowStore.showTimeline()).toBe(false)
      dispose()
    })
  })

  it('toggles sidebar and cards properly', () => {
    createRoot((dispose) => {
      const store = createWorkspaceLayoutStore(true)
      expect(store.affineCardOpen()).toBe(true)
      store.setAffineCardOpen(false)
      expect(store.affineCardOpen()).toBe(false)

      expect(store.randomizerOpen()).toBe(false)
      store.setRandomizerOpen(true)
      expect(store.randomizerOpen()).toBe(true)

      expect(store.randomizerAnimEpoch()).toBe(0)
      store.setRandomizerAnimEpoch(1)
      expect(store.randomizerAnimEpoch()).toBe(1)
      dispose()
    })
  })

  it('calculates sidebarWidth and floating actions position', () => {
    createRoot((dispose) => {
      const store = createWorkspaceLayoutStore(true)
      expect(store.sidebarWidth()).toBe(26)
      store.setSidebarLayoutMode('compact')
      expect(store.sidebarWidth()).toBe(21)
      expect(store.floatingTop()).toBe(8)
      dispose()
    })
  })

  it('determines isWideLayout correctly', () => {
    expect(typeof isWideLayout()).toBe('boolean')
    expect(WIDE_LAYOUT_MIN_WIDTH).toBe(769)
  })

  it('provides phone and tablet layout signals and constants', () => {
    createRoot((dispose) => {
      const store = createWorkspaceLayoutStore()
      expect(typeof store.isPhone()).toBe('boolean')
      expect(typeof store.isTablet()).toBe('boolean')
      expect(typeof store.isTouchLayout()).toBe('boolean')
      expect(typeof isTouchLayout()).toBe('boolean')
      resizeTo(500, 900)
      expect(store.isPhone()).toBe(true)
      expect(store.isTouchLayout()).toBe(true)
      expect(isTouchLayout()).toBe(true)
      resizeTo(900, 700)
      expect(store.isTablet()).toBe(true)
      expect(store.isTouchLayout()).toBe(true)
      expect(deckFits()).toBe(true)

      // Test manual touch preference override
      store.setTouchLayoutPreference('desktop')
      expect(store.isPhone()).toBe(false)
      expect(store.isTablet()).toBe(false)
      expect(store.isTouchLayout()).toBe(false)
      expect(isTouchLayout()).toBe(false)

      store.setTouchLayoutPreference('touch')
      resizeTo(1440, 900)
      expect(store.isTablet()).toBe(true)
      expect(store.isTouchLayout()).toBe(true)
      expect(isTouchLayout()).toBe(true)

      store.setTouchLayoutPreference('auto')
      resizeTo(1024, 768)
      dispose()
    })
  })
})
