// Audio transport contract tests cover clock continuity, deliberate playback and stale async work.
import assert from 'node:assert/strict'
import test from 'node:test'
import { OrbAudio } from '../src/audio'

class Param {
  value = 1
  setValueAtTime(value: number) {
    this.value = value
  }
  setTargetAtTime(value: number) {
    this.value = value
  }
  linearRampToValueAtTime(value: number) {
    this.value = value
  }
  cancelScheduledValues() {}
}

class Node {
  destination: unknown = null
  disconnected = false
  gain = new Param()
  connect(destination: unknown) {
    this.destination = destination
  }
  disconnect() {
    this.disconnected = true
  }
}

class Source extends Node {
  buffer: unknown
  loop = false
  loopEnd = 0
  onended: (() => void) | null = null
  offset = -1
  stopped = false
  start(_when: number, offset: number) {
    this.offset = offset
  }
  stop() {
    this.stopped = true
    this.onended?.()
  }
}

class Context extends EventTarget {
  currentTime = 0
  sampleRate = 32000
  state = 'suspended'
  sources: Source[] = []
  gains: Node[] = []
  destination = new Node()
  analyser = Object.assign(new Node(), {
    fftSize: 0,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData: (array: Float32Array) => array.fill(0.1),
    getFloatFrequencyData: (array: Float32Array) => {
      array.fill(-Infinity)
      array[10] = -20
    },
  })
  decode = () => Promise.resolve({ duration: 48.022 } as AudioBuffer)
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
  createAnalyser() {
    return this.analyser
  }
  createGain() {
    const gain = new Node()
    this.gains.push(gain)
    return gain
  }
  createBufferSource() {
    const source = new Source()
    this.sources.push(source)
    return source
  }
  decodeAudioData() {
    return this.decode()
  }
}

function fixture(fetchTrack?: typeof fetch) {
  const context = new Context()
  let contexts = 0
  let fetches = 0
  const audio = new OrbAudio({
    createContext: () => {
      contexts++
      return context as unknown as AudioContext
    },
    fetchTrack:
      fetchTrack ??
      (() => {
        fetches++
        return Promise.resolve(new Response(new Uint8Array([1])))
      }),
  })
  return { audio, context, calls: () => ({ contexts, fetches }) }
}

await test('silent until Play; pause freezes time and envelopes; resume reuses decoded audio and offset', async () => {
  const { audio, context, calls } = fixture()
  assert.deepEqual(calls(), { contexts: 0, fetches: 0 })
  assert.equal(audio.snapshot().status, 'idle')
  assert.equal(audio.sample().energy, 0)
  await audio.play()
  assert.deepEqual(calls(), { contexts: 1, fetches: 1 })
  assert.equal(audio.snapshot().status, 'playing')
  assert.equal(audio.snapshot().duration, 48)
  assert.equal(context.sources[0].loopEnd, 48)
  context.currentTime = 1
  const frame = audio.sample()
  assert.equal(frame.time, 1)
  assert.ok(Math.abs(frame.energy - 0.3 * (1 - Math.exp(-0.25 / 0.18))) < 1e-7)
  audio.pause()
  const frozen = { ...frame }
  assert.equal(context.sources[0].stopped, true)
  context.currentTime = 10
  assert.deepEqual(audio.sample(), frozen)
  assert.equal(audio.snapshot().elapsed, 1)
  await audio.play()
  assert.equal(context.sources[1].offset, 1)
  assert.deepEqual(calls(), { contexts: 1, fetches: 1 })
  context.currentTime = 11
  assert.equal(audio.sample().time, 2)
  audio.dispose()
  assert.equal(context.state, 'closed')
})

await test('muting and volume control output after analysis without stopping the music clock', async () => {
  const { audio, context } = fixture()
  await audio.play()
  audio.setMuted(true)
  assert.equal(context.gains[0].gain.value, 0)
  assert.equal(context.analyser.destination, context.gains[0])
  context.currentTime = 0.18
  const frame = audio.sample()
  assert.ok(Math.abs(frame.low - 0.3 * (1 - Math.exp(-1))) < 1e-7)
  assert.equal(frame.time, 0.18)
  audio.setVolume(0.25)
  audio.setMuted(false)
  assert.equal(context.gains[0].gain.value, 0.25)
  audio.setVolume(4)
  assert.equal(audio.snapshot().volume, 1)
  audio.setVolume(NaN)
  assert.equal(audio.snapshot().volume, 0)
  audio.dispose()
})

await test('looping keeps shader time continuous; restart resets the transport and envelopes', async () => {
  const { audio, context } = fixture()
  await audio.play()
  context.currentTime = 49
  assert.equal(audio.sample().time, 49)
  assert.equal(audio.snapshot().elapsed, 1)
  audio.pause()
  await audio.play()
  assert.equal(
    context.sources[1].offset,
    1,
    'Resume must skip decoder padding too',
  )
  await audio.restart()
  assert.equal(audio.sample().time, 0)
  assert.equal(audio.sample().energy, 0)
  assert.equal(context.sources[2].offset, 0)
  assert.equal(context.sources[2].loop, true)
  assert.equal(context.sources[2].loopEnd, 48)
  audio.dispose()
})

await test('Pause during decoding prevents a late start; concurrent Play is deduplicated', async () => {
  const { audio, context, calls } = fixture()
  let resolve!: (buffer: AudioBuffer) => void
  context.decode = () =>
    new Promise((r) => {
      resolve = r
    })
  const first = audio.play()
  assert.equal(audio.play(), first)
  await new Promise((r) => setTimeout(r, 0))
  audio.pause()
  resolve({ duration: 48 } as AudioBuffer)
  await first
  assert.equal(audio.snapshot().status, 'paused')
  assert.equal(context.sources.length, 0)
  await audio.play()
  assert.equal(context.sources.length, 1)
  assert.deepEqual(calls(), { contexts: 1, fetches: 1 })
  audio.dispose()
})

await test('Dispose during decoding releases the context and cannot create a late source', async () => {
  const { audio, context } = fixture()
  let resolve!: (buffer: AudioBuffer) => void
  context.decode = () =>
    new Promise((r) => {
      resolve = r
    })
  const playing = audio.play()
  await new Promise((r) => setTimeout(r, 0))
  audio.dispose()
  resolve({ duration: 48 } as AudioBuffer)
  await playing
  await audio.play()
  assert.equal(context.sources.length, 0)
  assert.equal(context.state, 'closed')
})

await test('Download errors surface without rejection and a later Play retries', async () => {
  let attempts = 0
  const { audio, context } = fixture(() => {
    attempts++
    return Promise.resolve(
      attempts === 1
        ? new Response('', { status: 503 })
        : new Response(new Uint8Array([1])),
    )
  })
  await audio.play()
  assert.equal(audio.snapshot().status, 'error')
  assert.match(audio.snapshot().error!, /503/)
  await audio.play()
  assert.equal(audio.snapshot().status, 'playing')
  assert.equal(audio.snapshot().error, null)
  assert.equal(context.sources.length, 1)
  audio.dispose()
})

await test('Platform audio suspension freezes the frame and requires a deliberate resume', async () => {
  const { audio, context } = fixture()
  await audio.play()
  context.currentTime = 2
  context.state = 'suspended'
  context.dispatchEvent(new Event('statechange'))
  assert.equal(audio.snapshot().status, 'paused')
  context.currentTime = 5
  assert.equal(audio.sample().time, 2)
  assert.equal(context.sources[0].stopped, true)
  await audio.play()
  assert.equal(context.sources[1].offset, 2)
  audio.dispose()
})

await test('a truncated decoded score fails before playback and can be retried', async () => {
  const { audio, context } = fixture()
  context.decode = () => Promise.resolve({ duration: 47.999 } as AudioBuffer)
  await audio.play()
  assert.equal(audio.snapshot().status, 'error')
  assert.match(audio.snapshot().error!, /shorter than its 48-second score/)
  assert.equal(context.sources.length, 0)
  context.decode = () => Promise.resolve({ duration: 48 } as AudioBuffer)
  await audio.play()
  assert.equal(audio.snapshot().status, 'playing')
  assert.equal(context.sources[0].loopEnd, 48)
  audio.dispose()
})
