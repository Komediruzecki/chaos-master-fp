// Journey awards survive re-entry and storage failures without overwriting unknown saves.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { MotifAudio } from '../src/almanac/motifAudio'
import { createJourneyProgress, createJourneyStore, getEarnedPages, isJourneyComplete, isJourneyWorldId, JOURNEY_STORAGE_KEY, parseJourneyProgress, } from '../src/journey/progress'
import type { JourneyProgress, JourneyStorage, JourneyWorldId, } from '../src/journey/progress'

function memoryStorage(initial: string | null = null) {
  let raw = initial
  let writes = 0
  return {
    get raw() {
      return raw
    },
    get writes() {
      return writes
    },
    getItem(key: string) {
      assert.equal(key, JOURNEY_STORAGE_KEY)
      return raw
    },
    setItem(key: string, value: string) {
      assert.equal(key, JOURNEY_STORAGE_KEY)
      raw = value
      writes++
    },
    replace(value: string | null) {
      raw = value
    },
  }
}

const storeFor = (storage: JourneyStorage) =>
  createJourneyStore({ worlds: ALMANAC_WORLDS, storage: () => storage })

function completedSave(): JourneyProgress {
  const store = storeFor(memoryStorage())
  store.completeWorld('glasswake')
  store.completeWorld('tideweave')
  return store.read().progress
}

await test('new journey has no visits or awards and inspecting a world earns nothing', () => {
  const storage = memoryStorage()
  const store = storeFor(storage)
  assert.deepEqual(store.read(), {
    progress: createJourneyProgress(),
    persistence: { status: 'ready', reason: null },
  })
  assert.equal(storage.writes, 0)
  store.selectWorld('tideweave')
  assert.equal(store.read().progress.lastSelectedWorld, 'tideweave')
  assert.equal(store.read().progress.worlds.tideweave.discovered, false)
  assert.equal(getEarnedPages(store.read().progress).length, 0)
  assert.equal(isJourneyComplete(store.read().progress), false)
  store.discoverWorld('glasswake')
  assert.equal(store.read().progress.worlds.glasswake.discovered, true)
  assert.equal(store.read().progress.worlds.glasswake.completion, null)
})

await test('onboarding and explicit visits survive reload independently of completion', () => {
  const storage = memoryStorage()
  const store = storeFor(storage)
  store.completeOnboarding()
  store.discoverWorld('tideweave')
  const resumed = storeFor(storage).read()
  assert.equal(resumed.progress.onboardingCompleted, true)
  assert.equal(resumed.progress.lastSelectedWorld, 'tideweave')
  assert.equal(resumed.progress.worlds.tideweave.discovered, true)
  assert.equal(resumed.progress.worlds.glasswake.discovered, false)
  assert.equal(resumed.progress.worlds.tideweave.completion, null)
  assert.equal(resumed.persistence.status, 'saved')
})

await test('both completion orders earn exactly two pages and duplicate completion is idempotent', () => {
  for (const order of [
    ['glasswake', 'tideweave'],
    ['tideweave', 'glasswake'],
  ] as const) {
    const storage = memoryStorage()
    const store = storeFor(storage)
    store.completeWorld(order[0])
    assert.equal(isJourneyComplete(store.read().progress), false)
    const first = store.read().progress
    store.completeWorld(order[0])
    assert.deepEqual(store.read().progress, first)
    store.completeWorld(order[1])
    assert.equal(isJourneyComplete(store.read().progress), true)
    assert.deepEqual(
      getEarnedPages(storeFor(storage).read().progress).map(
        (page) => page.worldId,
      ),
      ['glasswake', 'tideweave'],
    )
  }
})

await test('earned page freezes the catalog recipe and motif identity at completion', () => {
  const worlds = structuredClone(ALMANAC_WORLDS)
  const storage = memoryStorage()
  const store = createJourneyStore({ worlds, storage: () => storage })
  store.completeWorld('glasswake')
  const original = store.read().progress.worlds.glasswake.completion!
  assert.equal(original.name, 'Glasswake')
  assert.equal(original.activity.id, 'glasswake-seals')
  assert.equal(original.activity.version, 1)
  assert.equal(original.specimen.recipeId, 'rosette')
  assert.equal(original.specimen.version, 1)
  assert.equal(original.specimen.seed, 73129)
  assert.equal(original.motif.id, 'glasswake-first-light')
  assert.equal(original.motif.version, 1)
  assert.deepEqual(
    original.motif.notes.map((note) => note.midi),
    [60, 64, 67, 71, 72, 67, 64, 60],
  )
  worlds[0].name = 'Revised world'
  worlds[0].specimen!.seed = 12
  worlds[0].motif!.tempo = 120
  store.completeWorld('glasswake')
  store.discoverWorld('glasswake')
  assert.deepEqual(store.read().progress.worlds.glasswake.completion, original)
  assert.deepEqual(
    storeFor(storage).read().progress.worlds.glasswake.completion,
    original,
  )
})

await test('caller mutations and subscriber mutations cannot erase or rewrite store awards', () => {
  const store = storeFor(memoryStorage())
  const seen: number[] = []
  const unsubscribe = store.subscribe((snapshot) => {
    seen.push(getEarnedPages(snapshot.progress).length)
    snapshot.progress.worlds.glasswake.completion = null
  })
  store.completeWorld('glasswake')
  const returned = store.read()
  returned.progress.worlds.glasswake.completion!.name = 'Changed outside'
  const pages = getEarnedPages(store.read().progress)
  pages[0].specimen.seed = 10
  assert.equal(
    store.read().progress.worlds.glasswake.completion!.name,
    'Glasswake',
  )
  assert.equal(
    store.read().progress.worlds.glasswake.completion!.specimen.seed,
    73129,
  )
  unsubscribe()
  store.completeWorld('tideweave')
  assert.deepEqual(seen, [1])
})

await test('missing storage and a blocked storage getter retain a playable in-memory journey', () => {
  for (const storage of [
    undefined,
    () => null,
    () => {
      throw new Error('Access denied')
    },
  ]) {
    const store = createJourneyStore({ worlds: ALMANAC_WORLDS, storage })
    store.completeOnboarding()
    store.completeWorld('glasswake')
    store.completeWorld('tideweave')
    assert.equal(isJourneyComplete(store.read().progress), true)
    assert.deepEqual(store.read().persistence, {
      status: 'memory',
      reason: 'unavailable',
    })
  }
})

await test('a failed read never attempts to write over unread browser data', () => {
  let writes = 0
  const store = storeFor({
    getItem() {
      throw new Error('Read blocked')
    },
    setItem() {
      writes++
    },
  })
  store.completeWorld('tideweave')
  assert.equal(
    store.read().progress.worlds.tideweave.completion!.activity.id,
    'tideweave-trace',
  )
  assert.deepEqual(store.read().persistence, {
    status: 'memory',
    reason: 'read-failed',
  })
  assert.equal(writes, 0)
})

await test('quota failure keeps awards in memory and the next action retries after storage recovers', () => {
  const storage = memoryStorage()
  let blocked = true
  const store = storeFor({
    getItem: (key) => storage.getItem(key),
    setItem(key, value) {
      if (blocked) throw new Error('QuotaExceededError')
      storage.setItem(key, value)
    },
  })
  store.completeWorld('glasswake')
  assert.deepEqual(store.read().persistence, {
    status: 'memory',
    reason: 'write-failed',
  })
  assert.equal(storage.raw, null)
  assert.equal(getEarnedPages(store.read().progress).length, 1)
  blocked = false
  store.completeWorld('tideweave')
  assert.equal(store.read().persistence.status, 'saved')
  assert.equal(isJourneyComplete(storeFor(storage).read().progress), true)
})

await test('corrupt and oversized source values stay untouched while gameplay earns temporary pages', () => {
  for (const raw of [
    '{broken',
    '',
    'null',
    '[]',
    ' '.repeat(16385),
    JSON.stringify({ version: 1 }),
  ]) {
    const storage = memoryStorage(raw)
    const store = storeFor(storage)
    store.completeOnboarding()
    store.discoverWorld('tideweave')
    store.completeWorld('tideweave')
    store.refresh()
    assert.equal(storage.raw, raw)
    assert.equal(storage.writes, 0)
    assert.equal(
      store.read().progress.worlds.tideweave.completion!.worldId,
      'tideweave',
    )
    assert.deepEqual(store.read().persistence, {
      status: 'protected',
      reason: 'invalid-data',
    })
  }
})

await test('old and future versions are preserved without a guessed migration', () => {
  for (const version of [0, 2, 500]) {
    const raw = JSON.stringify({
      version,
      worlds: { future: 'Keep this data' },
    })
    const storage = memoryStorage(raw)
    const store = storeFor(storage)
    store.completeWorld('glasswake')
    assert.deepEqual(store.read().persistence, {
      status: 'protected',
      reason: 'unsupported-version',
    })
    assert.equal(storage.raw, raw)
    assert.equal(storage.writes, 0)
  }
})

await test('a save becoming future-versioned between actions is protected on the next write', () => {
  const storage = memoryStorage()
  const store = storeFor(storage)
  store.completeWorld('glasswake')
  const future = '{"version":2,"future":"preserve"}'
  storage.replace(future)
  store.completeWorld('tideweave')
  assert.equal(storage.raw, future)
  assert.equal(isJourneyComplete(store.read().progress), true)
  assert.equal(store.read().persistence.status, 'protected')
})

await test('ordinary stale tabs merge each others awards before writing', () => {
  const storage = memoryStorage()
  const first = storeFor(storage)
  const second = storeFor(storage)
  first.completeOnboarding()
  first.discoverWorld('glasswake')
  first.completeWorld('glasswake')
  second.discoverWorld('tideweave')
  second.completeWorld('tideweave')
  assert.equal(isJourneyComplete(storeFor(storage).read().progress), true)
  assert.equal(second.read().progress.onboardingCompleted, true)
  first.selectWorld('glasswake')
  const rejoined = storeFor(storage).read().progress
  assert.equal(rejoined.lastSelectedWorld, 'glasswake')
  assert.equal(isJourneyComplete(rejoined), true)
})

await test('refresh imports remote awards without writes or changing the active selection', () => {
  const storage = memoryStorage()
  const first = storeFor(storage)
  const second = storeFor(storage)
  first.discoverWorld('glasswake')
  second.discoverWorld('tideweave')
  second.completeWorld('tideweave')
  const before = storage.writes
  first.refresh()
  second.refresh()
  assert.equal(storage.writes, before)
  assert.equal(first.read().progress.lastSelectedWorld, 'glasswake')
  assert.equal(
    first.read().progress.worlds.tideweave.completion!.worldId,
    'tideweave',
  )
  assert.equal(first.read().persistence.status, 'saved')
})

await test('saved identity wins when an older tab completes a world with revised catalog data', () => {
  const storage = memoryStorage()
  const revised = structuredClone(ALMANAC_WORLDS)
  revised[0].name = 'Later identity'
  const first = storeFor(storage)
  const stale = createJourneyStore({ worlds: revised, storage: () => storage })
  first.completeWorld('glasswake')
  stale.completeWorld('glasswake')
  assert.equal(
    stale.read().progress.worlds.glasswake.completion!.name,
    'Glasswake',
  )
  assert.equal(
    storeFor(storage).read().progress.worlds.glasswake.completion!.name,
    'Glasswake',
  )
})

await test('only explicit reset may replace an unsupported save', () => {
  const storage = memoryStorage('{"version":7}')
  const store = storeFor(storage)
  store.completeWorld('glasswake')
  assert.equal(storage.writes, 0)
  store.reset()
  assert.deepEqual(storeFor(storage).read().progress, createJourneyProgress())
  assert.equal(storage.writes, 1)
  assert.equal(store.read().persistence.status, 'saved')
})

await test('valid stored snapshots remain readable after catalog content changes', () => {
  const original = completedSave()
  const parsed = parseJourneyProgress(JSON.stringify(original))
  assert.equal(parsed.kind, 'valid')
  if (parsed.kind === 'valid') assert.deepEqual(parsed.progress, original)
  assert.equal(JSON.stringify(original).length < 16384, true)
})

await test('saved motif boundaries reach the real audio score validator without rejection', async () => {
  for (const motif of [
    {
      tempo: 30,
      notes: [
        { midi: 24, beat: 0, duration: Number.EPSILON },
        { midi: 96, beat: 64, duration: 8 },
      ],
    },
    {
      tempo: 240,
      notes: Array.from({ length: 64 }, (_, beat) => ({
        midi: 60,
        beat,
        duration: 1,
      })),
    },
  ]) {
    const value = completedSave()
    Object.assign(value.worlds.glasswake.completion!.motif, motif)
    const parsed = parseJourneyProgress(JSON.stringify(value))
    assert.equal(parsed.kind, 'valid')
    if (parsed.kind !== 'valid') continue
    let contextRequests = 0
    const audio = new MotifAudio(() => {}, {
      createContext: () => {
        contextRequests++
        throw new Error('Score reached audio backend')
      },
    })
    await audio.play(parsed.progress.worlds.glasswake.completion!.motif)
    assert.equal(contextRequests, 1)
    assert.equal(audio.snapshot().error, 'Score reached audio backend')
    audio.dispose()
  }
})

await test('unplayable motif values are rejected both by persistence and the actual audio transport', async () => {
  for (const patch of [
    { tempo: 29 },
    { tempo: 241 },
    { notes: [{ midi: 23, beat: 0, duration: 1 }] },
    { notes: [{ midi: 97, beat: 0, duration: 1 }] },
    { notes: [{ midi: 60, beat: 65, duration: 1 }] },
    { notes: [{ midi: 60, beat: 0, duration: 0 }] },
    { notes: [{ midi: 60, beat: 0, duration: 8.1 }] },
    {
      notes: Array.from({ length: 65 }, () => ({
        midi: 60,
        beat: 0,
        duration: 1,
      })),
    },
  ]) {
    const value = completedSave()
    const motif = value.worlds.glasswake.completion!.motif
    Object.assign(motif, patch)
    assert.deepEqual(parseJourneyProgress(JSON.stringify(value)), {
      kind: 'invalid-data',
    })
    let contextRequests = 0
    const audio = new MotifAudio(() => {}, {
      createContext: () => {
        contextRequests++
        throw new Error('Score reached audio backend')
      },
    })
    await audio.play(motif)
    assert.equal(contextRequests, 0)
    assert.equal(audio.snapshot().error, 'This motif has no playable score.')
    audio.dispose()
  }
})

await test('malformed fields, injected state, invalid recipes and invalid notes fail closed', () => {
  const mutations: [string, unknown][] = [
    ['onboardingCompleted', 'yes'],
    ['lastSelectedWorld', 'hush-vault'],
    ['score', 9000],
    ['worlds.extra', {}],
    ['worlds.glasswake.discovered', undefined],
    ['worlds.glasswake.discovered', false],
    ['worlds.glasswake.completion.worldId', 'tideweave'],
    ['worlds.glasswake.completion.name', 'x'.repeat(65)],
    ['worlds.glasswake.completion.name', 'bad\nname'],
    ['worlds.glasswake.completion.activity.id', 'tideweave-trace'],
    ['worlds.glasswake.completion.activity.version', 2],
    ['worlds.glasswake.completion.specimen.recipeId', ['rosette']],
    ['worlds.glasswake.completion.specimen.recipeId', 'other'],
    ['worlds.glasswake.completion.specimen.seed', 1.5],
    ['worlds.glasswake.completion.specimen.seed', 0],
    ['worlds.glasswake.completion.specimen.visual', 'tideweave'],
    ['worlds.glasswake.completion.motif.version', 2],
    ['worlds.glasswake.completion.motif.tonic', 'D'],
    ['worlds.glasswake.completion.motif.tempo', 0],
    ['worlds.glasswake.completion.motif.notes', []],
    ['worlds.glasswake.completion.motif.notes.0.midi', 128],
    ['worlds.glasswake.completion.motif.notes.0.duration', 0],
    ['worlds.glasswake.completion.motif.notes.0.beat', 2],
    ['worlds.glasswake.completion.gpu', {}],
  ]
  for (const [path, invalid] of mutations) {
    const value = completedSave()
    const keys = path.split('.')
    let target = value as unknown as Record<string, unknown>
    for (const key of keys.slice(0, -1))
      target = target[key] as Record<string, unknown>
    target[keys.at(-1)!] = invalid
    assert.deepEqual(
      parseJourneyProgress(JSON.stringify(value)),
      { kind: 'invalid-data' },
      path,
    )
  }
})

await test('unknown and preview world IDs are rejected rather than creating hidden awards', () => {
  const store = storeFor(memoryStorage())
  for (const id of ['hush-vault', '__proto__', '', 0, null]) {
    assert.equal(isJourneyWorldId(id), false)
    assert.throws(
      () => store.completeWorld(id as JourneyWorldId),
      /Unknown journey world/u,
    )
    assert.throws(
      () => store.discoverWorld(id as JourneyWorldId),
      /Unknown journey world/u,
    )
    assert.throws(
      () => store.selectWorld(id as JourneyWorldId),
      /Unknown journey world/u,
    )
  }
  assert.deepEqual(store.read().progress, createJourneyProgress())
})
