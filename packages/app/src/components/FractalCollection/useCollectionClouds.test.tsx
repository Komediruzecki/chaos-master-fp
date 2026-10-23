/** Switching collections cancels sampling and ignores late replies without retaining old geometry. */
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
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

  function mount() {
    const [id, setId] = createSignal('reef')
    const [quality, setQuality] = createSignal<CollectionQuality>('normal')
    let state!: ReturnType<typeof useCollectionClouds>
    const view = render(() => {
      state = useCollectionClouds(id, quality)
      return null
    })
    return { state, setId, setQuality, dispose: view.unmount }
  }

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
