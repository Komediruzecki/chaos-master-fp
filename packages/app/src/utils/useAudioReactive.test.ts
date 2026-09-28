import { createRoot, createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reloadComfortPreset, setComfortPreset, } from '@/comfort/comfortPreference'
import { COMFORT_CAPS, COMFORT_PRESETS } from '@/comfort/comfortPresets'
import { useAudioReactive } from './useAudioReactive'
import type { AudioAnalyzer, AudioTargetValue, LiveAudioAnalyzer, } from './audioAnalysis'
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

describe('a mapping removed while audio runs', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('governs its target home before the overlay comes down', async () => {
    vi.useFakeTimers()
    let dispose = () => {}
    let setWiring: ((value: AudioMapping) => AudioMapping) | undefined
    const published: (AudioTargetValue[] | undefined)[] = []
    const publishedAt: number[] = []
    createRoot((rootDispose) => {
      dispose = rootDispose
      const [wiring, updateWiring] = createSignal(mapping)
      setWiring = updateWiring
      useAudioReactive(
        () => true,
        () => undefined,
        wiring,
        (values) => {
          published.push(values)
          publishedAt.push(globalThis.performance.now())
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
    if (!setWiring) throw new Error('audio test did not initialize')

    // Two seconds take vibrancy from the authored 2 toward the row's 1 at
    // Standard's window rate, 0.18 per 500 ms.
    vi.advanceTimersByTime(2000)
    const wired = published.length
    setWiring({ preset: 'custom', mappings: [] })
    vi.advanceTimersByTime(4000)

    const onScreen = published.map((values) => values?.[0]?.value ?? 2)
    const steps = onScreen
      .slice(1)
      .map((value, i) => Math.abs(value - onScreen[i]!))
    expect(onScreen[wired - 1]).toBeCloseTo(1.2818, 12)
    // Home at the rate it left. A frame is published once its move passes
    // the row's dirty threshold, 0.002, so one publish can carry that much
    // on top of a capped step of 0.6 a second over a 34 ms tick.
    expect(published.length - wired).toBe(37)
    expect(Math.max(...steps)).toBeLessThanOrEqual(0.6 * 0.034 + 0.002)
    expect(
      published.slice(wired, -2).every((values) => values?.length === 1),
    ).toBe(true)
    // Home, the overlay stays up with nothing on it for one Standard
    // brightness window more, while the modulator still holds what the
    // release showed, and only then comes down: on the first tick of the
    // fake 33 ms interval to take the rest to 500 ms, the 16th.
    expect(published.at(-2)).toEqual([])
    expect(published.at(-1)).toBeUndefined()
    expect(publishedAt.at(-1)! - publishedAt.at(-2)!).toBe(16 * 33)
    dispose()
  })
})

/**
 * An AudioContext whose clock the test sets. The hook reads the playback
 * position from `currentTime`; everything else is transport it never needs
 * to hear.
 */
let audioClock = 0
class SteppedAudioContext {
  readonly destination = {}
  get currentTime() {
    return audioClock
  }
  createBufferSource() {
    return {
      buffer: null as unknown,
      loop: false,
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    }
  }
  suspend() {
    return Promise.resolve()
  }
  resume() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
}

describe('a file played through a late tick', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    audioClock = 0
  })

  it('still delivers a beat that sits on the frame the tick skipped', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('AudioContext', SteppedAudioContext)
    // 48 kHz divides into 30 analyzer frames a second; the beat is frame 5.
    const analyzer: AudioAnalyzer = {
      sampleRate: 48_000,
      totalFrames: 300,
      duration: 10,
      getFrameData: (index) => ({
        bands: [0, 0, 0, 0, 0, 0, 0, 0],
        rms: 0,
        centroid: 0,
        flatness: 0,
        onsetStrength: 0,
        isBeat: index === 5,
      }),
    }
    const beatToSkipIters: AudioMapping = {
      preset: 'custom',
      mappings: [
        {
          audioFeature: 'beat',
          target: { kind: 'renderSetting', param: 'skipIters' },
          sensitivity: 1,
          range: [0, 50],
          attackMs: 1,
          releaseMs: 1000,
        },
      ],
    }
    let dispose = () => {}
    const published: (AudioTargetValue[] | undefined)[] = []
    createRoot((rootDispose) => {
      dispose = rootDispose
      useAudioReactive(
        () => true,
        () => ({ duration: 10 }) as AudioBuffer,
        () => beatToSkipIters,
        (values) => {
          published.push(values)
        },
        () => undefined,
        () => 'file',
        () => false,
        () => null,
        () => {},
        () => analyzer,
        () => false,
        () => ({ renderSettings: { skipIters: 0 } }),
      )
    })
    await Promise.resolve()

    // Ticks at frames 3 and 4, then one 70 ms late: frame 6.
    for (const seconds of [0.1, 0.134, 0.204]) {
      audioClock = seconds
      vi.advanceTimersByTime(34)
    }
    const skipIters = published.map((values) => values?.[0]?.value)
    // Each analyzer frame is 1/30 s. The beat's 1 ms attack takes the
    // envelope 97% of the way up in its own frame, and frame 6's 1000 ms
    // release lets it fall 1/31 of the way back.
    const frame = 1 / 30
    const attack = frame / (0.001 + frame)
    const release = frame / (1 + frame)
    expect(skipIters.at(-1)).toBeCloseTo(50 * attack * (1 - release), 9)
    dispose()
  })
})

/** The widest swing between two frames at most `span` frames apart. */
function worstSwing(series: readonly number[], span: number): number {
  let worst = 0
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j <= Math.min(series.length - 1, i + span); j++) {
      worst = Math.max(worst, Math.abs(series[i]! - series[j]!))
    }
  }
  return worst
}

describe('the last row leaving and coming back', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    audioClock = 0
    storage.clear()
    reloadComfortPreset()
  })

  // The only row leaves while loud audio holds exposure above the authored
  // 2, its target is governed home, and the row comes back on a quiet frame,
  // pulling the other way, 0, 3 or 6 frames after the target is home. The
  // hook took the overlay down on that arrival and started the modulator
  // over, which threw away the window the release had filled: the return
  // then swung 0.30 inside 500 ms on Standard and 0.60 on Intense.
  it.each(
    COMFORT_PRESETS.flatMap((preset) =>
      [0, 3, 6].map((after) => [preset, after] as const),
    ),
  )(
    'holds the %s window when the row returns %i frames after its target is home',
    async (preset, after) => {
      vi.useFakeTimers()
      vi.stubGlobal('AudioContext', SteppedAudioContext)
      setComfortPreset(preset)
      let level = 1
      // 48 kHz divides into 30 analyzer frames a second: one a tick.
      const analyzer: AudioAnalyzer = {
        sampleRate: 48_000,
        totalFrames: 100_000,
        duration: 3000,
        getFrameData: () => ({
          bands: [0, 0, 0, 0, 0, 0, 0, 0],
          rms: level,
          centroid: 0,
          flatness: 0,
          onsetStrength: 0,
          isBeat: false,
        }),
      }
      const row: AudioMapping = {
        preset: 'custom',
        mappings: [
          {
            audioFeature: 'rms',
            target: { kind: 'renderSetting', param: 'exposure' },
            sensitivity: 1,
            range: [0, 4],
          },
        ],
      }
      let dispose = () => {}
      let setWiring: ((value: AudioMapping) => AudioMapping) | undefined
      const published: (AudioTargetValue[] | undefined)[] = []
      createRoot((rootDispose) => {
        dispose = rootDispose
        const [wiring, updateWiring] = createSignal(row)
        setWiring = updateWiring
        useAudioReactive(
          () => true,
          () => ({ duration: 3000 }) as AudioBuffer,
          wiring,
          (values) => {
            published.push(values)
          },
          () => undefined,
          () => 'file',
          () => false,
          () => null,
          () => {},
          () => analyzer,
          () => false,
          () => ({ renderSettings: { exposure: 2 } }),
        )
      })
      await Promise.resolve()
      if (!setWiring) throw new Error('audio test did not initialize')

      const onScreen = [2]
      let frame = 0
      /** One analyzer frame; says whether the overlay shows exposure after it. */
      const tick = () => {
        frame++
        audioClock = (frame + 0.5) / 30
        vi.advanceTimersByTime(34)
        const shown = published
          .at(-1)
          ?.find(
            ({ target }) =>
              target.kind === 'renderSetting' && target.param === 'exposure',
          )
        onScreen.push(shown?.value ?? 2)
        return shown !== undefined
      }
      for (let i = 0; i < 90; i++) tick()
      setWiring({ preset: 'custom', mappings: [] })
      let frames = 0
      while (tick() && frames < 900) frames++
      for (let i = 0; i < after; i++) tick()
      level = 0
      setWiring(row)
      for (let i = 0; i < 60; i++) tick()
      expect(frames).toBeLessThan(900)
      expect(worstSwing(onScreen, 15)).toBeCloseTo(
        COMFORT_CAPS[preset].brightnessWindowRange,
        9,
      )
      dispose()
    },
  )
})
