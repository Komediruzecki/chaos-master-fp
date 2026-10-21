// Page relief follows earned progress across visit, replay, refresh and reload.
import assert from 'node:assert/strict'
import test from 'node:test'
import { earnedBookAwards } from '../src/almanac/bookAwards'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { createJourneyStore } from '../src/journey/progress'

await test('visiting earns no relief; each completed encounter adds only its own relief', () => {
  let saved: string | null = null
  let writes = 0
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value
      writes++
    },
  }
  const make = () =>
    createJourneyStore({ worlds: ALMANAC_WORLDS, storage: () => storage })
  const journey = make()
  journey.discoverWorld('glasswake')
  journey.discoverWorld('tideweave')
  assert.deepEqual(earnedBookAwards(journey.read().progress), {
    glasswake: false,
    tideweave: false,
  })
  const otherTab = make()
  journey.completeWorld('tideweave')
  assert.deepEqual(earnedBookAwards(journey.read().progress), {
    glasswake: false,
    tideweave: true,
  })
  const beforeRefresh = writes
  otherTab.refresh()
  assert.deepEqual(earnedBookAwards(otherTab.read().progress), {
    glasswake: false,
    tideweave: true,
  })
  assert.equal(
    writes,
    beforeRefresh,
    'refreshing relief must not write progress',
  )
  journey.completeWorld('glasswake')
  const identity = journey.read().progress
  journey.discoverWorld('tideweave')
  journey.completeWorld('tideweave')
  assert.deepEqual(journey.read().progress.worlds, identity.worlds)
  assert.deepEqual(earnedBookAwards(make().read().progress), {
    glasswake: true,
    tideweave: true,
  })
  journey.reset()
  assert.deepEqual(earnedBookAwards(journey.read().progress), {
    glasswake: false,
    tideweave: false,
  })
})

await test('relief recognizes the saved encounter version, independent of world motif notes', () => {
  const journey = createJourneyStore({ worlds: ALMANAC_WORLDS })
  journey.completeWorld('glasswake')
  journey.completeWorld('tideweave')
  const progress = journey.read().progress
  progress.worlds.tideweave.completion!.motif.notes = []
  assert.deepEqual(earnedBookAwards(progress), {
    glasswake: true,
    tideweave: true,
  })
  const before = structuredClone(progress)
  earnedBookAwards(progress)
  assert.deepEqual(progress, before, 'reading relief must not mutate the save')
  Object.assign(progress.worlds.tideweave.completion!.activity, { version: 2 })
  assert.deepEqual(earnedBookAwards(progress), {
    glasswake: true,
    tideweave: false,
  })
})
