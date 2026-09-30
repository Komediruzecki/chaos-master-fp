// Audio cancellation and score tests verify real transport decisions against a deterministic Web Audio clock.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ALMANAC_WORLDS, settingsForWorld } from '../src/almanac/catalog'
import { MotifAudio } from '../src/almanac/motifAudio'

class Param {
  value = 1
  values: number[] = []
  cancelledAt: number[] = []
  setValueAtTime(value: number) {
    this.value = value
    this.values.push(value)
  }
  setTargetAtTime(value: number) {
    this.value = value
    this.values.push(value)
  }
  linearRampToValueAtTime(value: number) {
    this.value = value
    this.values.push(value)
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value
    this.values.push(value)
  }
  cancelAndHoldAtTime() {}
  cancelScheduledValues(when: number) {
    this.cancelledAt.push(when)
  }
}

class AudioNodeMock {
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

class Oscillator extends AudioNodeMock {
  frequency = new Param()
  type = 'sine'
  startAt = -1
  stopAt = -1
  onended: (() => void) | null = null
  start(when: number) {
    this.startAt = when
  }
  stop(when: number) {
    this.stopAt = when
  }
}

class Context extends EventTarget {
  currentTime = 0
  state = 'suspended'
  destination = new AudioNodeMock()
  gains: AudioNodeMock[] = []
  oscillators: Oscillator[] = []
  analyser = Object.assign(new AudioNodeMock(), {
    fftSize: 0,
    getFloatTimeDomainData: (array: Float32Array) => array.fill(0.02),
  })
  resume = () => {
    this.state = 'running'
    return Promise.resolve()
  }
  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
  createGain() {
    const gain = new AudioNodeMock()
    this.gains.push(gain)
    return gain
  }
  createAnalyser() {
    return this.analyser
  }
  createOscillator() {
    const oscillator = new Oscillator()
    this.oscillators.push(oscillator)
    return oscillator
  }
}

class Visibility extends EventTarget {
  hidden = false
}

function fixture() {
  const context = new Context()
  const visibility = new Visibility()
  let contexts = 0
  let changes = 0
  const audio = new MotifAudio(
    () => {
      changes++
    },
    {
      createContext: () => {
        contexts++
        return context as unknown as AudioContext
      },
      visibility,
    },
  )
  return { audio, context, visibility, calls: () => ({ contexts, changes }) }
}

const glass = ALMANAC_WORLDS[0].motif!
const tide = ALMANAC_WORLDS[1].motif!

await test('two studies resolve stable recipes and five previews cannot silently use the last orb', () => {
  assert.equal(new Set(ALMANAC_WORLDS.map((world) => world.id)).size, 7)
  assert.deepEqual(
    ALMANAC_WORLDS.filter((world) => world.status === 'study').map(
      (world) => world.id,
    ),
    ['glasswake', 'tideweave'],
  )
  const first = settingsForWorld(ALMANAC_WORLDS[0])!
  const second = settingsForWorld(ALMANAC_WORLDS[1])!
  assert.equal(first.recipe, 0)
  assert.equal(first.seed, 73129)
  assert.equal(first.palette, 'lagoon')
  assert.equal(first.rotation, false)
  assert.equal(second.recipe, 1)
  for (const world of ALMANAC_WORLDS.slice(2)) {
    assert.equal(world.status, 'preview')
    assert.equal(world.specimen, undefined)
    assert.equal(world.motif, undefined)
    assert.equal(settingsForWorld(world), undefined)
  }
  assert.deepEqual(JSON.parse(JSON.stringify(ALMANAC_WORLDS)), ALMANAC_WORLDS)
})

await test('original motifs remain in C Ionian and D Dorian, including their distinguishing seventh and sixth', () => {
  assert.deepEqual(
    glass.notes.map((note) => note.midi),
    [60, 64, 67, 71, 72, 67, 64, 60],
  )
  assert.deepEqual(
    tide.notes.map((note) => note.midi),
    [62, 65, 67, 69, 71, 72, 69, 62],
  )
  for (const motif of [glass, tide]) {
    assert.ok(
      motif.notes.every((note) =>
        [0, 2, 4, 5, 7, 9, 11].includes(note.midi % 12),
      ),
    )
    assert.equal(motif.notes[0].midi, motif.notes.at(-1)!.midi)
  }
  assert.equal(glass.timbre, 'glass')
  assert.equal(tide.timbre, 'reed')
  assert.equal(glass.tempo, 84)
  assert.equal(tide.tempo, 88)
})

await test('silent construction; explicit Play schedules notes through the volume and activity meter', async (t) => {
  const { audio, context, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  assert.equal(calls().contexts, 0)
  assert.deepEqual(audio.snapshot(), {
    playing: false,
    loading: false,
    motifId: null,
    progress: 0,
    error: null,
    volume: 0.55,
    activeNote: null,
    level: 0,
  })
  await audio.play(glass)
  assert.equal(calls().contexts, 1)
  assert.equal(context.oscillators.length, 16)
  assert.equal(context.oscillators[0].startAt, 0.025)
  assert.ok(
    Math.abs(context.oscillators[0].frequency.value - 261.6255653005986) <
      1e-10,
  )
  assert.equal(context.oscillators[0].type, 'sine')
  assert.equal(context.gains[1].destination, context.gains[0])
  assert.equal(context.gains[0].destination, context.analyser)
  assert.equal(context.analyser.destination, context.destination)
  assert.ok(
    context.gains
      .slice(1)
      .every((gain) => Math.max(...gain.gain.values) <= 0.099),
  )
  context.currentTime = 1.525
  const snapshot = audio.snapshot()
  assert.equal(snapshot.playing, true)
  assert.equal(snapshot.motifId, glass.id)
  assert.equal(snapshot.activeNote, 2)
  assert.ok(
    Math.abs(snapshot.progress - 1.5 / ((8.6 * 60) / 84 + 0.18)) < 1e-10,
  )
  assert.ok(Math.abs(snapshot.level - 0.16) < 1e-7)
})

await test('switching cancels every old note before the next motif starts; stop resets activity', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.play(glass)
  const old = [...context.oscillators]
  context.currentTime = 1
  await audio.play(tide)
  assert.ok(old.every((oscillator) => oscillator.stopAt === 1.012))
  assert.equal(context.oscillators[16].startAt, 1.025)
  assert.equal(context.oscillators[16].type, 'triangle')
  assert.equal(audio.snapshot().motifId, tide.id)
  audio.stop()
  assert.equal(audio.snapshot().playing, false)
  assert.equal(audio.snapshot().motifId, null)
  assert.equal(audio.snapshot().activeNote, null)
  assert.equal(audio.snapshot().level, 0)
  assert.ok(
    context.oscillators.every((oscillator) => oscillator.stopAt === 1.012),
  )
})

await test('a slow audio unlock cannot start a superseded motif', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  const resumes: (() => void)[] = []
  context.resume = () =>
    new Promise<void>((resolve) => {
      resumes.push(() => {
        context.state = 'running'
        resolve()
      })
    })
  const first = audio.play(glass)
  assert.equal(audio.snapshot().loading, true)
  assert.equal(audio.snapshot().playing, false)
  const second = audio.play(tide)
  assert.equal(audio.snapshot().loading, true)
  resumes[1]()
  await second
  assert.equal(context.oscillators.length, 16)
  assert.equal(audio.snapshot().motifId, tide.id)
  assert.equal(audio.snapshot().loading, false)
  resumes[0]()
  await first
  assert.equal(context.oscillators.length, 16)
  assert.equal(audio.snapshot().motifId, tide.id)
})

await test('Stop works when the browser only offers cancelScheduledValues', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.play(glass)
  context.currentTime = 1
  for (const gain of context.gains) {
    Object.defineProperty(gain.gain, 'cancelAndHoldAtTime', {
      value: undefined,
    })
    gain.gain.value = 0.03
  }
  audio.stop()
  assert.equal(audio.snapshot().playing, false)
  assert.equal(audio.snapshot().loading, false)
  assert.ok(
    context.oscillators.every((oscillator) => oscillator.stopAt === 1.012),
  )
  for (const gain of context.gains.slice(1)) {
    assert.deepEqual(gain.gain.cancelledAt, [1])
    assert.deepEqual(gain.gain.values.slice(-2), [0.03, 0])
  }
})

await test('Stop and hidden-tab events cancel pending unlocks and never autoplay on return', async (t) => {
  const { audio, context, visibility } = fixture()
  t.after(() => {
    audio.dispose()
  })
  let unlock!: () => void
  context.resume = () =>
    new Promise<void>((resolve) => {
      unlock = () => {
        context.state = 'running'
        resolve()
      }
    })
  const first = audio.play(glass)
  assert.equal(audio.snapshot().loading, true)
  audio.stop()
  assert.equal(audio.snapshot().loading, false)
  unlock()
  await first
  assert.equal(context.oscillators.length, 0)
  const second = audio.play(tide)
  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  unlock()
  await second
  assert.equal(audio.snapshot().loading, false)
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(context.oscillators.length, 0)
  assert.equal(audio.snapshot().playing, false)
})

await test('natural completion releases notes and publishes a completed one-shot audition', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.play(glass)
  context.currentTime = Math.max(
    ...context.oscillators.map((oscillator) => oscillator.stopAt),
  )
  for (const oscillator of context.oscillators) oscillator.onended?.()
  assert.equal(audio.snapshot().playing, false)
  assert.equal(audio.snapshot().progress, 1)
  assert.equal(audio.snapshot().motifId, glass.id)
  assert.ok(context.oscillators.every((oscillator) => oscillator.disconnected))
  assert.equal(audio.snapshot().level, 0)
})

await test('volume clamps and platform suspension stops the score', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.play(tide)
  audio.setVolume(4)
  assert.equal(context.gains[0].gain.value, 1)
  audio.setVolume(NaN)
  assert.equal(context.gains[0].gain.value, 0)
  assert.equal(audio.snapshot().volume, 0)
  context.state = 'suspended'
  context.dispatchEvent(new Event('statechange'))
  assert.equal(audio.snapshot().playing, false)
  assert.ok(
    context.oscillators.every((oscillator) => oscillator.stopAt === 0.012),
  )
})

await test('failed unlock reports an error and explicit retry works', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  context.resume = () => Promise.reject(new Error('Audio device unavailable.'))
  await audio.play(glass)
  assert.equal(audio.snapshot().error, 'Audio device unavailable.')
  assert.equal(audio.snapshot().loading, false)
  assert.equal(context.oscillators.length, 0)
  context.resume = () => {
    context.state = 'running'
    return Promise.resolve()
  }
  await audio.play(tide)
  assert.equal(audio.snapshot().error, null)
  assert.equal(audio.snapshot().playing, true)
  assert.equal(audio.snapshot().loading, false)
})

await test('dispose during unlock cannot create notes or emit further updates', async () => {
  const { audio, context, visibility, calls } = fixture()
  let unlock!: () => void
  context.resume = () =>
    new Promise<void>((resolve) => {
      unlock = resolve
    })
  const pending = audio.play(glass)
  audio.dispose()
  assert.equal(audio.snapshot().loading, false)
  const changes = calls().changes
  unlock()
  await pending
  await audio.play(tide)
  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  audio.setVolume(1)
  assert.equal(context.oscillators.length, 0)
  assert.equal(context.state, 'closed')
  assert.equal(calls().changes, changes)
  assert.equal(context.analyser.disconnected, true)
})
