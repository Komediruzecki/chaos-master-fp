/** Switching collections cancels sampling and ignores late replies without retaining old geometry. */
import { cleanup, render } from '@solidjs/testing-library'
import { createEffect, createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCollectionClouds } from './useCollectionClouds'
import type { CollectionCloud, CollectionCloudReply, } from './collectionCloudWorker'
import type { CollectionQuality } from './collectionStageLayout'

class TestWorker {
  static all: TestWorker[] = []
  onmessage?: (event: MessageEvent<CollectionCloudReply>) => void
  onerror?: () => void
  onmessageerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    TestWorker.all.push(this)
  }
  reply(data: CollectionCloudReply) {
    this.onmessage?.({ data } as MessageEvent<CollectionCloudReply>)
  }
}
const cloud = (key: string): CollectionCloud => ({
  key,
  side: 'light',
  points: new Float32Array([1, 2, 3, 1]),
  colors: new Float32Array([1, 0, 0, 1]),
  bounds: { min: [1, 2, 3], max: [1, 2, 3] },
})

describe('useCollectionClouds', () => {
  beforeEach(() => {
    TestWorker.all = []
    vi.stubGlobal('Worker', TestWorker)
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function mount(cacheBudget?: {
    maxEntries: number
    maxBytes: number
    includeSolids?: boolean
  }) {
    const [id, setId] = createSignal('reef')
    const [quality, setQuality] = createSignal<CollectionQuality>('normal')
    let state!: ReturnType<typeof useCollectionClouds>
    const view = render(() => {
      state = useCollectionClouds(id, quality, cacheBudget)
      return null
    })
    return { state, setId, setQuality, dispose: view.unmount }
  }

  it('retains a job and its uploaded clouds when parent appearance objects change without changing sampling', () => {
    const [appearance, setAppearance] = createSignal<{
      collection: { id: string; enclosure: string }
      quality: CollectionQuality
      scale: number
    }>({
      collection: { id: 'wild-canopy', enclosure: 'pure' },
      quality: 'normal',
      scale: 0.9,
    })
    const upload = vi.fn()
    let state!: ReturnType<typeof useCollectionClouds>
    render(() => {
      state = useCollectionClouds(
        () => appearance().collection.id,
        () => appearance().quality,
      )
      createEffect(() => {
        if (state.clouds().length) upload(state.clouds())
      })
      return null
    })
    const worker = TestWorker.all[0]!
    setAppearance((previous) => ({
      ...previous,
      collection: { ...previous.collection, enclosure: 'glass' },
    }))
    expect(TestWorker.all).toHaveLength(1)
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(state.busy()).toBe(true)
    const sampled = [cloud('knight:light')]
    worker.reply({ clouds: sampled })
    expect(upload).toHaveBeenCalledExactlyOnceWith(sampled)

    setAppearance((previous) => ({
      ...previous,
      collection: { ...previous.collection, enclosure: 'pure' },
      scale: 0.95,
    }))
    expect(TestWorker.all).toHaveLength(1)
    expect(state.clouds()).toBe(sampled)
    expect(state.busy()).toBe(false)
    expect(upload).toHaveBeenCalledOnce()

    setAppearance((previous) => ({
      ...previous,
      collection: { ...previous.collection, id: 'tidal-relics' },
    }))
    expect(TestWorker.all).toHaveLength(2)
    expect(TestWorker.all[1]!.postMessage).toHaveBeenCalledWith({
      count: 24_000,
      collectionId: 'tidal-relics',
    })
    setAppearance((previous) => ({ ...previous, quality: 'high' }))
    expect(TestWorker.all).toHaveLength(3)
    expect(TestWorker.all[1]!.terminate).toHaveBeenCalledOnce()
    expect(TestWorker.all[2]!.postMessage).toHaveBeenCalledWith({
      count: 60_000,
      collectionId: 'tidal-relics',
    })
  })

  it('revisits a cached collection without a worker and keeps only the configured recent results', () => {
    const { state, setId, setQuality, dispose } = mount({
      maxEntries: 2,
      maxBytes: 4096,
    })
    const first = [cloud('reef')]
    TestWorker.all[0]!.reply({ clouds: first })
    expect(state.resultKey()).toBe('reef:normal')
    setId('tide')
    expect(state.resultKey()).toBe('')
    TestWorker.all[1]!.reply({ clouds: [cloud('tide')] })
    setId('reef')
    expect(state.clouds()).toBe(first)
    expect(state.busy()).toBe(false)
    expect(TestWorker.all).toHaveLength(2)
    setQuality('high')
    TestWorker.all[2]!.reply({ clouds: [cloud('reef-fine')] })
    setId('tide')
    setQuality('normal')
    expect(TestWorker.all).toHaveLength(5)
    dispose()
    TestWorker.all[4]!.reply({ clouds: [cloud('late')] })
    expect(state.clouds()).toEqual([])
  })

  it('opts Cinema into solid construction and preserves a nonfatal solid error with cached points', () => {
    const { state, setId } = mount({
      maxEntries: 2,
      maxBytes: 4096,
      includeSolids: true,
    })
    expect(TestWorker.all[0]!.postMessage).toHaveBeenCalledWith({
      collectionId: 'reef',
      count: 24_000,
      includeSolids: true,
    })
    TestWorker.all[0]!.reply({
      clouds: [cloud('reef')],
      solidError: 'No connected volume.',
    })
    expect(state.resultKey()).toBe('reef:normal:solids')
    expect(state.error()).toBe('')
    expect(state.solidError()).toBe('No connected volume.')
    setId('tide')
    TestWorker.all[1]!.reply({ clouds: [cloud('tide')] })
    setId('reef')
    expect(TestWorker.all).toHaveLength(2)
    expect(state.solidError()).toBe('No connected volume.')
    expect(state.clouds()[0]!.key).toBe('reef')
  })

  it('runs source construction in the worker and drops stale replies after switching', () => {
    const { state, setId, dispose } = mount()
    const old = TestWorker.all[0]!
    expect(old.postMessage).toHaveBeenCalledWith({
      count: 24_000,
      collectionId: 'reef',
    })
    old.reply({ clouds: [cloud('reef')] })
    expect(state.busy()).toBe(false)
    expect(state.clouds()[0]!.key).toBe('reef')
    setId('tide')
    const next = TestWorker.all[1]!
    expect(old.terminate).toHaveBeenCalled()
    expect(state.clouds()).toEqual([])
    old.reply({ clouds: [cloud('stale')] })
    expect(state.clouds()).toEqual([])
    expect(state.busy()).toBe(true)
    next.reply({ clouds: [cloud('tide')] })
    expect(state.clouds()[0]!.key).toBe('tide')
    dispose()
    expect(next.terminate).toHaveBeenCalled()
  })

  it('publishes matching clouds and glass together, retains them, and discards a cancelled shell', () => {
    const [id, setId] = createSignal('wild-canopy')
    const [quality, setQuality] = createSignal<CollectionQuality>('normal')
    const observed = vi.fn()
    let state!: ReturnType<typeof useCollectionClouds>
    render(() => {
      state = useCollectionClouds(id, quality)
      createEffect(() => observed(state.clouds(), state.shell()))
      return null
    })
    const glass = { vertices: new Float32Array([1, 2, 3]), radius: 0.7 }
    const first = TestWorker.all[0]!
    setId('tidal-relics')
    first.reply({ clouds: [cloud('old')], shell: glass })
    expect(state.shell()).toBeUndefined()
    expect(state.clouds()).toEqual([])
    observed.mockClear()
    const sampled = [cloud('bishop:light')]
    const solidGlass = { vertices: new Float32Array([3, 2, 1]), radius: 0.8 }
    TestWorker.all[1]!.reply({
      clouds: sampled,
      shell: glass,
      solidShell: solidGlass,
    })
    expect(state.solidShell()).toBe(solidGlass)
    expect(observed).toHaveBeenCalledExactlyOnceWith(sampled, glass)
    expect(state.shell()).toBe(glass)
    setId('tidal-relics')
    expect(TestWorker.all).toHaveLength(2)
    expect(state.shell()).toBe(glass)
    setQuality('high')
    expect(state.clouds()).toEqual([])
    expect(state.shell()).toBeUndefined()
    expect(state.solidShell()).toBeUndefined()
    TestWorker.all[2]!.reply({ error: 'Could not fit glass' })
    expect(state.busy()).toBe(false)
    expect(state.error()).toBe('Could not fit glass')
    expect(state.shell()).toBeUndefined()
  })

  it('cancels an unfinished job on quality changes and owns the current job until unmount', () => {
    const { state, setQuality, dispose } = mount()
    const old = TestWorker.all[0]!
    setQuality('high')
    expect(old.terminate).toHaveBeenCalledOnce()
    expect(TestWorker.all[1]!.postMessage).toHaveBeenCalledWith({
      count: 60_000,
      collectionId: 'reef',
    })
    old.reply({ clouds: [cloud('stale')] })
    expect(state.clouds()).toEqual([])
    dispose()
    expect(TestWorker.all[1]!.terminate).toHaveBeenCalledOnce()
    TestWorker.all[1]!.reply({ clouds: [cloud('disposed')] })
    expect(state.clouds()).toEqual([])
  })

  it.each(['timeout', 'messageerror'] as const)(
    'exits busy state and terminates after %s',
    (failure) => {
      const { state } = mount()
      const worker = TestWorker.all[0]!
      if (failure === 'timeout') vi.advanceTimersByTime(60_000)
      else worker.onmessageerror?.()
      expect(state.busy()).toBe(false)
      expect(state.error()).toContain('preview builder stopped')
      expect(worker.terminate).toHaveBeenCalledOnce()
      worker.reply({ clouds: [cloud('late')] })
      expect(state.clouds()).toEqual([])
    },
  )
})
