// The live analyzer: what it asks the browser for, and the frame processor it
// runs on the microphone's newest samples, fed synthetic signals here.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLiveAnalyzer, createLiveFrameProcessor, MIC_CONSTRAINTS, } from './audioAnalysis'
import { addBand, addNoise, clicks, noise, TEST_SAMPLE_RATE, } from './audioAnalysis.testUtils'
import type { LiveFrameProcessor } from './audioAnalysis'
import type { FrameData } from './audioMapping'

const FFT_SIZE = 2048

type Read = { time: number; frame: FrameData & { isBeat: boolean } }

/** The newest FFT_SIZE samples of `samples` heard at `time`, as an
 *  AnalyserNode hands them over. */
function newest(samples: Float32Array, time: number): Float32Array {
  const end = Math.round(time * TEST_SAMPLE_RATE)
  const window = new Float32Array(FFT_SIZE)
  const from = Math.max(0, end - FFT_SIZE)
  window.set(samples.subarray(from, end), FFT_SIZE - (end - from))
  return window
}

/** Every read of a processor polled at `times` over `samples`. */
function poll(
  processor: LiveFrameProcessor,
  samples: Float32Array,
  times: readonly number[],
): Read[] {
  return times.map((time) => ({
    time,
    frame: processor.process(newest(samples, time), time),
  }))
}

/** `count` poll times, `rate` a second from 1 / rate. */
function every(rate: number, count: number): number[] {
  return Array.from({ length: count }, (_, k) => (k + 1) / rate)
}

/** The times an event first shows in a run of reads (it is held a while). */
function rises(
  reads: readonly Read[],
  isOn: (read: Read) => boolean,
): number[] {
  return reads
    .filter((read, k) => isOn(read) && (k === 0 || !isOn(reads[k - 1]!)))
    .map((read) => Math.round(read.time * 1000) / 1000)
}

// 1 s of silence, sixteen clicks every 0.5 s, then 2 s of silence.
const CLICK_TIMES = Array.from({ length: 16 }, (_, c) => 1 + 0.5 * c)
const TRACK = clicks(
  11,
  CLICK_TIMES,
  CLICK_TIMES.map(() => 0.5),
)

/**
 * A stand-in for the browser's microphone and audio graph: a context in
 * `state` whose resume() settles as `resume` does, and the calls
 * createLiveAnalyzer makes on them.
 */
function stubMicrophone(state: AudioContextState, resume: () => Promise<void>) {
  const calls = {
    resume: vi.fn(resume),
    stopTrack: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
  }
  const stream = { getTracks: () => [{ stop: calls.stopTrack }] }
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: () => Promise.resolve(stream) },
  })
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 48000
      currentTime = 0
      state = state
      resume = calls.resume
      close = calls.close
      createMediaStreamSource = node
      createAnalyser = () => ({
        ...node(),
        fftSize: 2048,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData: vi.fn(),
      })
    },
  )
  return calls
}

describe('the microphone', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts a suspended audio context, and leaves a running one be', async () => {
    const suspended = stubMicrophone('suspended', () => Promise.resolve())
    const analyzer = await createLiveAnalyzer()
    expect(suspended.resume).toHaveBeenCalledOnce()
    analyzer.dispose()
    const running = stubMicrophone('running', () => Promise.resolve())
    ;(await createLiveAnalyzer()).dispose()
    expect(running.resume).not.toHaveBeenCalled()
  })

  it('fails the start when the context will not run, and gives the microphone back', async () => {
    const calls = stubMicrophone('suspended', () =>
      Promise.reject(new Error('the context will not start')),
    )
    await expect(createLiveAnalyzer()).rejects.toThrow(
      'the context will not start',
    )
    expect(calls.stopTrack).toHaveBeenCalledOnce()
    expect(calls.close).toHaveBeenCalledOnce()
  })

  it('is asked for as music, with the browser call processing off', async () => {
    const getUserMedia = vi.fn(() => Promise.reject(new Error('denied')))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    await expect(createLiveAnalyzer()).rejects.toThrow('denied')
    expect(getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS)
    expect(MIC_CONSTRAINTS).toEqual({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  })
})

describe('the live frame processor', () => {
  it.each([30, 60])(
    'finds an onset and a beat at every click polled %i times a second, and none in silence',
    (rate) => {
      const processor = createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE)
      const reads = poll(processor, TRACK, every(rate, 11 * rate))
      // Each at the first poll after its click.
      const firstPolls = CLICK_TIMES.map(
        (time) => Math.round((time + 1 / rate) * 1000) / 1000,
      )
      expect(rises(reads, (read) => read.frame.onsetStrength > 0)).toEqual(
        firstPolls,
      )
      expect(rises(reads, (read) => read.frame.isBeat)).toEqual(firstPolls)
    },
  )

  it.each([0, 0.003, 0.007, 0.011, 0.014, 0.03])(
    'shows the modulation loop every event while the node graph and the meters poll the same input %s s after it',
    (offset) => {
      // The three callers the app has: the modulation loop every 1/30 s, the
      // wiring editor's node graph about as often, and its meters every 50 ms.
      const modulation = every(30, 330)
      const nodeGraph = modulation.map((time) => time + offset)
      const meters = every(20, 220).map((time) => time + offset)
      const shared = poll(
        createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE),
        TRACK,
        [...modulation, ...nodeGraph, ...meters].sort((a, b) => a - b),
      )
      // What the modulation loop read: its first read at each of its times.
      const seen = modulation.map(
        (time) => shared.find((read) => read.time === time)!,
      )
      const polls = (times: number[]) =>
        times.map((time, c) => Math.round((time - CLICK_TIMES[c]!) * 30))
      // Every click, at the first modulation poll after it.
      const onsets = rises(seen, (read) => read.frame.onsetStrength > 0)
      const beats = rises(seen, (read) => read.frame.isBeat)
      expect(onsets).toHaveLength(16)
      expect(beats).toHaveLength(16)
      expect(new Set([...polls(onsets), ...polls(beats)])).toEqual(new Set([1]))
    },
  )

  it('shows the modulation loop every event on a clock that steps, even when its timer is late', () => {
    // The audio clock as the main thread sees it, in steps of 21.3 ms. The
    // modulation loop's timer fires every 33 +/- 8 ms, and every seventh tick
    // 45 ms late besides, as a long task delays it; the meters and the node
    // graph poll the same input at random times.
    const uniform = (
      (next) => () =>
        (next() + 1) / 2
    )(noise(3))
    const clock = (time: number) => Math.floor(time / 0.0213) * 0.0213
    const polls: { time: number; loop: boolean }[] = []
    for (let time = 0.033, tick = 1; time < 10.5; tick++) {
      polls.push({ time, loop: true })
      time += 0.033 + (uniform() * 2 - 1) * 0.008 + (tick % 7 === 0 ? 0.045 : 0)
    }
    for (
      let time = uniform() * 0.05;
      time < 10.5;
      time += 0.001 + uniform() * 0.049
    ) {
      polls.push({ time, loop: false })
    }
    polls.sort((a, b) => a.time - b.time)
    const processor = createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE)
    const reads = polls.map((poll) => ({
      ...poll,
      frame: processor.process(
        newest(TRACK, clock(poll.time)),
        clock(poll.time),
      ),
    }))
    const tests = {
      onset: (frame: FrameData) => frame.onsetStrength > 0,
      beat: (frame: FrameData & { isBeat: boolean }) => frame.isBeat,
    }
    // Every event, whichever caller found it, and those the loop's next read
    // after it does not show.
    const events = Object.entries(tests).map(([name, isOn]) => {
      const found = reads.filter(
        (read, k) =>
          isOn(read.frame) && (k === 0 || !isOn(reads[k - 1]!.frame)),
      )
      const unseen = found.filter((event) => {
        const next = reads.find((read) => read.loop && read.time >= event.time)
        return next !== undefined && !isOn(next.frame)
      })
      return { name, found: found.length, unseen: unseen.map((e) => e.time) }
    })
    // Twelve of the sixteen clicks are found: when no poll lands in a step,
    // two analyses are 43 ms apart, and a click between them sits at the tail
    // of one window and the head of the next, too faint in both to count.
    expect(events).toEqual([
      { name: 'onset', found: 12, unseen: [] },
      { name: 'beat', found: 12, unseen: [] },
    ])
  })

  it('does not let one knock 19 dB over the clicks quieten the onsets 2 s after it', () => {
    // Clicks every half second for 20 s; in one run, a knock 19 dB louder at
    // 5.25 s, between two of them.
    const times = Array.from({ length: 38 }, (_, c) => 1 + 0.5 * c)
    const plain = clicks(
      21,
      times,
      times.map(() => 0.5),
    )
    const knocked = clicks(
      21,
      [...times, 5.25],
      [...times.map(() => 0.5), 0.5 * 10 ** (19 / 20)],
    )
    const strengths = (samples: Float32Array) => {
      const reads = poll(
        createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE),
        samples,
        every(30, 21 * 30),
      )
      // Each click's onset, at the first poll after it.
      return times
        .filter((time) => time >= 7.25)
        .map(
          (time) => reads.find((read) => read.time > time)!.frame.onsetStrength,
        )
    }
    const before = strengths(plain)
    const after = strengths(knocked)
    expect(before).toHaveLength(25)
    // At least 0.9 of what each click read without the knock: 0.995.
    const ratios = after.map((strength, c) => strength / before[c]!)
    expect(Math.min(...ratios)).toBeCloseTo(0.995, 3)
  })

  it('gives a caller that polls within 5 ms of the last analysis the same frame', () => {
    const processor = createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE)
    const first = processor.process(newest(TRACK, 1.01), 1.01)
    // 3 ms later the samples have moved on by a render quantum; the frame has not.
    expect(processor.process(newest(TRACK, 1.013), 1.013)).toEqual(first)
    expect(processor.process(newest(TRACK, 1.02), 1.02)).not.toEqual(first)
  })

  it('holds a beat for 100 ms of audio, however often it is polled', () => {
    const polledWithBeat = (rate: number) => {
      const reads = poll(
        createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE),
        TRACK,
        every(rate, 2 * rate),
      )
      // The first click, at 1 s, up to the next one.
      return reads.filter((read) => read.time < 1.4 && read.frame.isBeat).length
    }
    // From the poll that found it until 100 ms later: 1.033 to 1.1 s at
    // 30 Hz, three polls; 1.017 to 1.1 s at 60 Hz, six.
    expect(polledWithBeat(30)).toBe(3)
    expect(polledWithBeat(60)).toBe(6)
  })

  it('reads a band from its quiet level, 0, to its loud one, 1', () => {
    // A 100 Hz tone, a second loud and a second 30 dB quieter by turns for
    // 20 s, then a second 18 dB over the quiet level.
    const tone = new Float32Array(21 * TEST_SAMPLE_RATE)
    for (let i = 0; i < tone.length; i++) {
      const second = Math.floor(i / TEST_SAMPLE_RATE)
      const db = second === 20 ? -12 : second % 2 === 0 ? 0 : -30
      tone[i] =
        0.1 *
        10 ** (db / 20) *
        Math.sin((2 * Math.PI * 100 * i) / TEST_SAMPLE_RATE)
    }
    const reads = poll(
      createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE),
      tone,
      every(30, 21 * 30),
    )
    const bass = (time: number) =>
      reads.find((read) => Math.abs(read.time - time) < 1e-9)!.frame.bands[1]
    // The zero sits at the quiet level plus the 5.95 dB the bass band's nine
    // bins wobble by on noise, the top at the loud level 30 dB up: 18 dB up
    // reads (18 - 5.95) / (30 - 5.95), 0.50. The loud level reads a hair
    // under 1: the top is placed within its 0.5 dB bin by weight.
    expect(bass(18.5)).toBeCloseTo(0.989, 3)
    expect(bass(19.5)).toBe(0)
    expect(bass(20.5)).toBeCloseTo(0.498, 3)
  })
})

/** Per band, the mean and 95th percentile of the readings in [from, to). */
function bandStats(reads: readonly Read[], from: number, to: number) {
  const inside = reads.filter((read) => read.time >= from && read.time < to)
  return Array.from({ length: 8 }, (_, band) => {
    const values = inside
      .map((read) => read.frame.bands[band]!)
      .sort((a, b) => a - b)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    return { mean, p95: values[Math.floor(0.95 * (values.length - 1))]! }
  })
}

/** The worst band's mean and 95th percentile, to two places. */
function worstBand(stats: readonly { mean: number; p95: number }[]) {
  const round = (value: number) => Math.round(value * 100) / 100
  return {
    mean: round(Math.max(...stats.map((band) => band.mean))),
    p95: round(Math.max(...stats.map((band) => band.p95))),
  }
}

describe('the live band levels', () => {
  it.each([-80, -70, -60])(
    'read room noise at %i dB as about 0 in every band, from the first second and still at 120 s',
    (db) => {
      const room = addNoise(new Float32Array(122 * TEST_SAMPLE_RATE), db)
      const reads = poll(
        createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE),
        room,
        every(30, 121 * 30),
      )
      // At most a mean of 0.15 and a 95th percentile of 0.35, in every band.
      expect([
        worstBand(bandStats(reads, 0, 1)),
        worstBand(bandStats(reads, 120, 121)),
      ]).toEqual([
        { mean: 0, p95: 0 },
        { mean: 0.02, p95: 0 },
      ])
    },
    60_000,
  )

  it('read about 0 in every band within 5 s of the music stopping, and long after', () => {
    // A quiet room, -70 dB, and a band playing in it from 10 s to 40 s.
    const samples = addBand(
      addNoise(new Float32Array(282 * TEST_SAMPLE_RATE), -70),
      10,
      40,
    )
    const reads = poll(
      createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE),
      samples,
      every(30, 281 * 30),
    )
    // At most a mean of 0.15 in every band: the second before 5 s after the
    // music stops, and the seconds 30, 120 and 240 s after.
    const worstMeans = [4, 30, 120, 240].map(
      (after) => worstBand(bandStats(reads, 40 + after, 41 + after)).mean,
    )
    expect(worstMeans).toEqual([0, 0.02, 0.02, 0.01])
  }, 60_000)

  it('keep every band within 0.1 of their reading 2 s after a burst 30 dB over the clicks', () => {
    // Clicks every half second for 30 s; in one run, 50 ms of noise 30 dB
    // louder at 10.1 s, between two clicks.
    const times = Array.from({ length: 58 }, (_, c) => 1 + 0.5 * c)
    const plain = clicks(
      31,
      times,
      times.map(() => 0.5),
    )
    const burst = plain.slice()
    const next = noise(11)
    const from = Math.round(10.1 * TEST_SAMPLE_RATE)
    for (let i = from; i < from + 0.05 * TEST_SAMPLE_RATE; i++) {
      burst[i] = 0.5 * 10 ** (30 / 20) * next()
    }
    const run = (samples: Float32Array) =>
      poll(
        createLiveFrameProcessor(TEST_SAMPLE_RATE, FFT_SIZE),
        samples,
        every(30, 30 * 30),
      )
    const [a, b] = [run(plain), run(burst)]
    let worst = 0
    a.forEach((read, k) => {
      if (read.time < 12.1) return
      read.frame.bands.forEach((level, band) => {
        worst = Math.max(worst, Math.abs(level - b[k]!.frame.bands[band]!))
      })
    })
    // At most 0.1, from 2 s after the burst to the end.
    expect(Math.round(worst * 1000) / 1000).toBe(0.05)
  })
})
