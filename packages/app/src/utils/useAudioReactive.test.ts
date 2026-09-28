import { createRoot, createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reloadComfortPreset, setComfortPreset, } from '@/comfort/comfortPreference'
import { useAudioReactive } from './useAudioReactive'
import type { AudioTargetValue, LiveAudioAnalyzer } from './audioAnalysis'
import type { AudioMapping } from '@/components/AudioReactivePanel/AudioReactivePanel'

// localStorage is not usable in this runtime; the comfort preference lives in
// an in-memory map.
const storage = new Map<string, string>()
vi.mock('@/utils/storage', () => ({
  safeGetItem: (key: string) => storage.get(key) ?? null,
  safeSetItem: (key: string, value: string) => {
    storage.set(key, value)
    return true
  },
  safeRemoveItem: (key: string) => {
    storage.delete(key)
  },
}))

const mapping: AudioMapping = {
  preset: 'custom',
  mappings: [
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 1,
      range: [0.5, 1.5],
    },
  ],
}

const mic: LiveAudioAnalyzer = {
  sampleRate: 48_000,
  dispose: vi.fn(),
  getFrameData: () => ({
    bands: [0, 0.5, 0, 0, 0, 0, 0, 0],
    rms: 0.25,
    centroid: 0,
    flatness: 0,
    onsetStrength: 0,
    isBeat: false,
  }),
}

describe('audio modulation suspension', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('freezes both the overlay and smoothing time while replay owns the document', async () => {
    vi.useFakeTimers()
    let dispose = () => {}
    let setSuspended: ((value: boolean) => boolean) | undefined
    const published: (AudioTargetValue[] | undefined)[] = []
    createRoot((rootDispose) => {
      dispose = rootDispose
      const [suspended, updateSuspended] = createSignal(false)
      setSuspended = updateSuspended

      useAudioReactive(
        () => true,
        () => undefined,
        () => mapping,
        (values) => {
          published.push(values)
        },
        () => mic,
        () => 'mic',
        () => false,
        () => null,
        () => undefined,
        () => undefined,
        suspended,
      )

      // Solid schedules the first createEffect after the owning root callback;
      // wait for it before advancing the interval's fake clock.
    })

    await Promise.resolve()
    if (!setSuspended) throw new Error('audio test did not initialize')

    vi.advanceTimersByTime(34)
    expect(published).toHaveLength(1)
    const firstFrame = published[0]
    expect(firstFrame).toHaveLength(1)

    setSuspended(true)
    vi.advanceTimersByTime(100)
    // The overlay comes down once and stays down: what a replay shows must be
    // the document it replayed, with nothing of the live mic over it.
    expect(published).toEqual([firstFrame, undefined])

    setSuspended(false)
    vi.advanceTimersByTime(34)
    // And back up on the very first tick after the suspension. The modulator
    // started over when the overlay came down, and with no authored flame to
    // ease in from, its first frame is the mapped value again.
    expect(published).toHaveLength(3)
    expect(published[2]).toEqual(firstFrame)
    dispose()
  })
})

describe('the authored flame', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('eases the overlay in from it, and again after the mic restarts', async () => {
    vi.useFakeTimers()
    let dispose = () => {}
    let setEnabled: ((value: boolean) => boolean) | undefined
    const published: (AudioTargetValue[] | undefined)[] = []
    createRoot((rootDispose) => {
      dispose = rootDispose
      const [enabled, updateEnabled] = createSignal(true)
      setEnabled = updateEnabled
      useAudioReactive(
        enabled,
        () => undefined,
        () => mapping,
        (values) => {
          published.push(values)
        },
        () => mic,
        () => 'mic',
        () => false,
        () => null,
        () => undefined,
        () => undefined,
        () => false,
        () => ({ renderSettings: { vibrancy: 2 } }),
      )
    })

    await Promise.resolve()
    if (!setEnabled) throw new Error('audio test did not initialize')

    // bass 0.5 maps to vibrancy 1. Standard comfort moves vibrancy 0.6 a
    // second, so the first 1/30 s frame is 0.02 down from the authored 2.
    const eased = 1.98
    vi.advanceTimersByTime(34)
    expect(published).toHaveLength(1)
    expect(published[0]![0]!.value).toBeCloseTo(eased, 12)

    setEnabled(false)
    setEnabled(true)
    vi.advanceTimersByTime(34)
    expect(published).toHaveLength(3)
    expect(published[1]).toBeUndefined()
    expect(published[2]![0]!.value).toBeCloseTo(eased, 12)
    dispose()
  })
})

describe('the comfort preset', () => {
  afterEach(() => {
    vi.useRealTimers()
    storage.clear()
    reloadComfortPreset()
  })

  it('follows a preset chosen while the overlay runs', async () => {
    vi.useFakeTimers()
    storage.clear()
    reloadComfortPreset()
    let dispose = () => {}
    const published: (AudioTargetValue[] | undefined)[] = []
    createRoot((rootDispose) => {
      dispose = rootDispose
      useAudioReactive(
        () => true,
        () => undefined,
        () => mapping,
        (values) => {
          published.push(values)
        },
        () => mic,
        () => 'mic',
        () => false,
        () => null,
        () => undefined,
        () => undefined,
        () => false,
        () => ({ renderSettings: { vibrancy: 2 } }),
      )
    })
    await Promise.resolve()

    vi.advanceTimersByTime(34)
    setComfortPreset('calm')
    vi.advanceTimersByTime(34)
    // One standard step down from 2 (0.6 a second over the first tick's
    // 1/30 s), then one calm step (0.3 a second) over the 33 ms the fake
    // interval took.
    expect(published).toHaveLength(2)
    expect(published[1]![0]!.value).toBeCloseTo(
      2 - (0.6 / 30 + 0.3 * 0.033),
      12,
    )
    dispose()
  })
})
