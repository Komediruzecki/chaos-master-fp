// Component-owned progress subscription imports storage changes without restarting audio or encounters.
import { createSignal, onCleanup, onMount } from 'solid-js'
import { ALMANAC_WORLDS } from '../almanac/catalog'
import { createJourneyStore, JOURNEY_STORAGE_KEY } from './progress'

export function useJourney() {
  const store = createJourneyStore({
    worlds: ALMANAC_WORLDS,
    storage: () => window.localStorage,
  })
  const [snapshot, setSnapshot] = createSignal(store.read())
  const unsubscribe = store.subscribe(setSnapshot)
  onCleanup(unsubscribe)
  onMount(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === JOURNEY_STORAGE_KEY || event.key === null)
        store.refresh()
    }
    const visible = () => {
      if (!document.hidden) store.refresh()
    }
    window.addEventListener('storage', refresh)
    document.addEventListener('visibilitychange', visible)
    onCleanup(() => {
      window.removeEventListener('storage', refresh)
      document.removeEventListener('visibilitychange', visible)
    })
  })
  return { store, snapshot }
}
