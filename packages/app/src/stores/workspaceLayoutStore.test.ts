import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { createWorkspaceLayoutStore, isWideLayout, WIDE_LAYOUT_MIN_WIDTH, } from './workspaceLayoutStore'

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
      store.setIsPhone(true)
      expect(store.isPhone()).toBe(true)
      store.setIsTablet(true)
      expect(store.isTablet()).toBe(true)

      // Test manual touch preference override
      store.setTouchLayoutPreference('desktop')
      expect(store.isPhone()).toBe(false)
      expect(store.isTablet()).toBe(false)

      store.setTouchLayoutPreference('touch')
      store.setIsPhone(false)
      expect(store.isTablet()).toBe(true)

      store.setTouchLayoutPreference('auto')
      dispose()
    })
  })
})
