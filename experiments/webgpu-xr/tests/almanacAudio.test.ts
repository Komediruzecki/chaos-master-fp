// Audio cancellation and score tests verify real transport decisions against a deterministic Web Audio clock.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ALMANAC_WORLDS, settingsForWorld } from '../src/almanac/catalog'
import { MotifAudio } from '../src/almanac/motifAudio'
import { TEMPLE_DURATION_SECONDS, TEMPLE_SCORE, } from '../src/journey/templeScore'

class Param {
  value = 1
  values: number[] = []
  cancelledAt: number[] = []
  targets: { value: number; at?: number; timeConstant?: number }[] = []
  setValueAtTime(value: number) {
    this.value = value
    this.values.push(value)
  }
  setTargetAtTime(value: number, at?: number, timeConstant?: number) {
    this.value = value
    this.values.push(value)
    this.targets.push({ value, at, timeConstant })
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
    trace: { active: false, pending: false, midi: null, accentMidi: null },
    effect: { active: false, pending: false, midi: null },
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

await test('trace movement needs an explicit start and shares the volume and analyser path', async (t) => {
  const { audio, context, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  audio.updateTrace(69, 69)
  audio.finishTrace(69)
  assert.equal(calls().contexts, 0)
  await audio.startTrace(62, 62)
  assert.equal(calls().contexts, 1)
  assert.equal(context.oscillators.length, 2)
  assert.deepEqual(audio.snapshot().trace, {
    active: true,
    pending: false,
    midi: 62,
    accentMidi: 62,
  })
  assert.equal(audio.snapshot().playing, false)
  assert.equal(audio.snapshot().motifId, null)
  assert.equal(context.oscillators[0].type, 'triangle')
  assert.equal(context.oscillators[1].type, 'sine')
  assert.equal(context.oscillators[0].startAt, 0.025)
  assert.equal(context.oscillators[1].startAt, 0.025)
  assert.equal(context.gains[1].destination, context.gains[0])
  assert.equal(context.gains[2].destination, context.gains[0])
  assert.ok(
    context.gains
      .slice(1)
      .every((gain) => Math.max(...gain.gain.values) <= 0.065),
  )
  context.currentTime = 0.1
  audio.updateTrace(65.5, 65)
  const frequency = context.oscillators[0].frequency.targets.at(-1)!
  assert.ok(Math.abs(frequency.value - 440 * 2 ** ((65.5 - 69) / 12)) < 1e-10)
  assert.equal(frequency.at, 0.1)
  assert.equal(frequency.timeConstant, 0.025)
  assert.ok(
    Math.abs(
      context.oscillators[2].frequency.value - 440 * 2 ** ((65 - 69) / 12),
    ) < 1e-10,
  )
  assert.ok(Math.abs(audio.snapshot().level - 0.16) < 1e-7)
  audio.setVolume(0)
  assert.equal(context.gains[0].gain.value, 0)
  assert.equal(audio.snapshot().volume, 0)
  audio.stopTrace()
  assert.equal(audio.snapshot().trace.active, false)
  assert.equal(audio.snapshot().level, 0)
  assert.ok(context.oscillators.every((voice) => voice.stopAt === 0.112))
})

await test('motifs and tracing cancel each other with one context and non-overlapping starts', async (t) => {
  const { audio, context, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.play(glass)
  const motifVoices = [...context.oscillators]
  context.currentTime = 1
  await audio.startTrace(62, 62)
  assert.ok(motifVoices.every((voice) => voice.stopAt === 1.012))
  const traceVoices = context.oscillators.slice(16)
  assert.ok(traceVoices.every((voice) => voice.startAt === 1.025))
  assert.equal(audio.snapshot().playing, false)
  context.currentTime = 2
  await audio.play(tide)
  assert.ok(traceVoices.every((voice) => voice.stopAt === 2.012))
  assert.equal(audio.snapshot().trace.active, false)
  assert.equal(audio.snapshot().motifId, tide.id)
  assert.equal(calls().contexts, 1)
})

await test('lifting or hiding during trace unlock cannot play a delayed tone or restart on movement', async (t) => {
  for (const interruption of ['lift', 'hide'] as const) {
    await t.test(interruption, async (t) => {
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
      const pending = audio.startTrace(62, 62)
      assert.equal(audio.snapshot().trace.pending, true)
      audio.updateTrace(71, 71)
      if (interruption === 'lift') audio.stopTrace()
      else {
        visibility.hidden = true
        visibility.dispatchEvent(new Event('visibilitychange'))
      }
      unlock()
      await pending
      visibility.hidden = false
      visibility.dispatchEvent(new Event('visibilitychange'))
      audio.updateTrace(65, 65)
      assert.equal(context.oscillators.length, 0)
      assert.deepEqual(audio.snapshot().trace, {
        active: false,
        pending: false,
        midi: null,
        accentMidi: null,
      })
    })
  }
})

await test('a pending trace starts at the latest cursor pitch after unlock', async (t) => {
  const { audio, context } = fixture()
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
  const pending = audio.startTrace(62, 62)
  audio.updateTrace(71, 71)
  unlock()
  await pending
  assert.ok(
    context.oscillators.every(
      (voice) =>
        Math.abs(voice.frequency.value - 440 * 2 ** ((71 - 69) / 12)) < 1e-10,
    ),
  )
  assert.equal(audio.snapshot().trace.midi, 71)
  audio.updateTrace(69)
  assert.equal(context.oscillators[0].frequency.targets.at(-1)?.at, 0.025)
})

await test('completion has a bounded exact-pitch accent and interruption cancels its tail', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.startTrace(71)
  context.currentTime = 0.5
  audio.finishTrace(69)
  assert.equal(context.oscillators[0].stopAt, 0.58)
  assert.equal(context.oscillators[1].frequency.value, 440)
  assert.equal(context.oscillators[1].stopAt, 0.74)
  audio.updateTrace(62)
  assert.equal(audio.snapshot().trace.midi, 69)
  audio.stopTrace()
  assert.ok(context.oscillators.every((voice) => voice.stopAt === 0.512))
  assert.equal(audio.snapshot().trace.active, false)
})

await test('platform suspension and disposal stop trace voices without automatic recovery', async (t) => {
  const { audio, context, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.startTrace(65, 65)
  context.state = 'suspended'
  context.dispatchEvent(new Event('statechange'))
  assert.equal(audio.snapshot().trace.active, false)
  context.state = 'running'
  context.dispatchEvent(new Event('statechange'))
  audio.updateTrace(69)
  assert.equal(context.oscillators.length, 2)
  await audio.startTrace(69)
  audio.dispose()
  assert.equal(context.state, 'closed')
  assert.ok(context.oscillators.every((voice) => voice.disconnected))
  const changes = calls().changes
  await audio.startTrace(62)
  assert.equal(calls().changes, changes)
  assert.equal(audio.snapshot().trace.active, false)
})

await test('invalid pitches cannot schedule or continue tracing audio', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.startTrace(NaN)
  assert.equal(context.oscillators.length, 0)
  assert.match(audio.snapshot().error ?? '', /playable pitch/)
  await audio.startTrace(62)
  audio.updateTrace(Infinity)
  assert.equal(audio.snapshot().trace.active, false)
  audio.finishTrace(NaN)
  assert.equal(audio.snapshot().trace.active, false)
})

await test('a failed trace unlock needs a fresh gesture before explicit retry succeeds', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  context.resume = () => Promise.reject(new Error('Audio device unavailable.'))
  await audio.startTrace(62, 62)
  assert.equal(audio.snapshot().error, 'Audio device unavailable.')
  assert.equal(audio.snapshot().trace.pending, false)
  assert.equal(context.oscillators.length, 0)
  context.resume = () => {
    context.state = 'running'
    return Promise.resolve()
  }
  audio.updateTrace(65)
  assert.equal(context.oscillators.length, 0)
  await audio.startTrace(65, 65)
  assert.equal(audio.snapshot().error, null)
  assert.equal(audio.snapshot().trace.active, true)
  assert.equal(context.oscillators.length, 2)
})

await test('disposing during a trace unlock prevents delayed nodes and further notifications', async () => {
  const { audio, context, calls } = fixture()
  let unlock!: () => void
  context.resume = () =>
    new Promise<void>((resolve) => {
      unlock = resolve
    })
  const pending = audio.startTrace(62, 62)
  audio.dispose()
  const changes = calls().changes
  unlock()
  await pending
  audio.updateTrace(71, 71)
  audio.finishTrace(69)
  await audio.startTrace(62)
  assert.equal(context.oscillators.length, 0)
  assert.equal(context.state, 'closed')
  assert.equal(calls().changes, changes)
  assert.deepEqual(audio.snapshot().trace, {
    active: false,
    pending: false,
    midi: null,
    accentMidi: null,
  })
})

await test('glass release uses six bounded partials through the existing volume and analyser', async (t) => {
  const { audio, context, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  audio.setVolume(0.3)
  assert.equal(calls().contexts, 0)
  await audio.shatter(60)
  assert.equal(calls().contexts, 1)
  assert.equal(context.oscillators.length, 6)
  assert.deepEqual(audio.snapshot().effect, {
    active: true,
    pending: false,
    midi: 60,
  })
  assert.equal(audio.snapshot().playing, false)
  assert.equal(audio.snapshot().trace.active, false)
  assert.equal(audio.snapshot().loading, false)
  assert.equal(context.gains[0].gain.value, 0.3)
  assert.equal(context.gains[0].destination, context.analyser)
  assert.equal(context.analyser.destination, context.destination)
  assert.ok(
    context.gains
      .slice(1)
      .every((gain) => gain.destination === context.gains[0]),
  )
  const peaks = context.gains
    .slice(1)
    .map((gain) => Math.max(...gain.gain.values))
  assert.ok(peaks.every((peak) => peak > 0 && peak <= 0.03))
  assert.ok(peaks.reduce((sum, peak) => sum + peak, 0) < 0.1)
  assert.ok(
    context.oscillators.every(
      (voice) =>
        voice.type === 'sine' && voice.startAt >= 0.025 && voice.stopAt <= 1.2,
    ),
  )
  const frequencies = context.oscillators.map((voice) => voice.frequency.value)
  assert.ok(Math.abs(frequencies[0] - 261.6255653005986) < 1e-10)
  assert.ok(
    frequencies.every(
      (frequency, i) =>
        Number.isFinite(frequency) &&
        (i === 0 || frequency > frequencies[i - 1]),
    ),
  )
  assert.ok(audio.snapshot().level > 0)
  audio.setVolume(0)
  assert.equal(context.gains[0].gain.value, 0)
  assert.equal(audio.snapshot().volume, 0)
})

await test('glass cue, instrument and motif replace each other without overlapping starts', async (t) => {
  const { audio, context, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.startTrace(60)
  const instrument = context.oscillators[0]
  context.currentTime = 1
  await audio.shatter(60)
  assert.equal(instrument.stopAt, 1.012)
  assert.equal(audio.snapshot().trace.active, false)
  const firstCue = context.oscillators.slice(1)
  assert.ok(firstCue.every((voice) => voice.startAt >= 1.025))
  // The instrument's eventual end callback must not erase the newer cue.
  instrument.onended?.()
  assert.equal(audio.snapshot().effect.active, true)
  audio.stopTrace()
  assert.equal(audio.snapshot().effect.active, true)
  context.currentTime = 1.2
  await audio.shatter(64)
  assert.ok(firstCue.every((voice) => voice.stopAt === 1.212))
  const secondCue = context.oscillators.slice(7)
  for (const voice of firstCue) voice.onended?.()
  assert.equal(audio.snapshot().effect.midi, 64)
  context.currentTime = 2
  await audio.startTrace(67)
  assert.ok(secondCue.every((voice) => voice.stopAt === 2.012))
  assert.equal(audio.snapshot().effect.active, false)
  await audio.shatter(67)
  const lastCue = context.oscillators.slice(-6)
  context.currentTime = 3
  await audio.play(glass)
  assert.ok(lastCue.every((voice) => voice.stopAt === 3.012))
  assert.equal(audio.snapshot().effect.active, false)
  assert.equal(audio.snapshot().motifId, glass.id)
  assert.equal(calls().contexts, 1)
})

await test('natural glass completion releases all nodes and clears the effect meter', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.shatter(67)
  const endings = [...context.oscillators].sort((a, b) => a.stopAt - b.stopAt)
  for (const voice of endings.slice(0, -1)) {
    context.currentTime = voice.stopAt
    voice.onended?.()
    assert.equal(audio.snapshot().effect.active, true)
  }
  context.currentTime = endings.at(-1)!.stopAt
  endings.at(-1)!.onended?.()
  assert.deepEqual(audio.snapshot().effect, {
    active: false,
    pending: false,
    midi: null,
  })
  assert.equal(audio.snapshot().level, 0)
  assert.ok(
    context.oscillators.every(
      (voice) => voice.disconnected && voice.onended === null,
    ),
  )
  assert.ok(context.gains.slice(1).every((gain) => gain.disconnected))
})

await test('stop, hide, suspension and dispose cancel glass unlocks without delayed playback', async (t) => {
  for (const interruption of ['stop', 'hide', 'suspend', 'dispose'] as const) {
    await t.test(interruption, async (t) => {
      const { audio, context, visibility, calls } = fixture()
      t.after(() => {
        audio.dispose()
      })
      let unlock!: () => void
      context.resume = () =>
        new Promise<void>((resolve) => {
          unlock = resolve
        })
      const pending = audio.shatter(60)
      assert.deepEqual(audio.snapshot().effect, {
        active: false,
        pending: true,
        midi: 60,
      })
      if (interruption === 'stop') audio.stop()
      else if (interruption === 'hide') {
        visibility.hidden = true
        visibility.dispatchEvent(new Event('visibilitychange'))
      } else if (interruption === 'suspend')
        context.dispatchEvent(new Event('statechange'))
      else audio.dispose()
      const changes = calls().changes
      unlock()
      await pending
      assert.equal(calls().changes, changes)
      assert.equal(context.oscillators.length, 0)
      assert.equal(audio.snapshot().loading, false)
      assert.deepEqual(audio.snapshot().effect, {
        active: false,
        pending: false,
        midi: null,
      })
      visibility.hidden = false
      visibility.dispatchEvent(new Event('visibilitychange'))
      assert.equal(context.oscillators.length, 0)
    })
  }
})

await test('a newer instrument or motif wins when a glass unlock resolves late', async (t) => {
  for (const replacement of ['instrument', 'motif'] as const) {
    await t.test(replacement, async (t) => {
      const { audio, context } = fixture()
      t.after(() => {
        audio.dispose()
      })
      let unlock!: () => void
      context.resume = () =>
        new Promise<void>((resolve) => {
          unlock = resolve
        })
      const pending = audio.shatter(60)
      context.resume = () => {
        context.state = 'running'
        return Promise.resolve()
      }
      if (replacement === 'instrument') await audio.startTrace(64)
      else await audio.play(tide)
      const count = context.oscillators.length
      unlock()
      await pending
      assert.equal(context.oscillators.length, count)
      assert.equal(audio.snapshot().effect.active, false)
      assert.equal(audio.snapshot().effect.pending, false)
      if (replacement === 'instrument')
        assert.equal(audio.snapshot().trace.midi, 64)
      else assert.equal(audio.snapshot().motifId, tide.id)
    })
  }
})

await test('active glass tails stop on hidden tabs and disposal leaves no live nodes or callbacks', async (t) => {
  const { audio, context, visibility, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.shatter(60)
  context.currentTime = 0.2
  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.ok(
    context.oscillators.every(
      (voice) => Math.abs(voice.stopAt - 0.212) < 1e-10,
    ),
  )
  assert.equal(audio.snapshot().effect.active, false)
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(context.oscillators.length, 6)
  await audio.shatter(64)
  audio.dispose()
  const changes = calls().changes
  assert.equal(context.state, 'closed')
  assert.ok(
    context.oscillators.every(
      (voice) => voice.disconnected && voice.onended === null,
    ),
  )
  assert.ok(context.gains.every((gain) => gain.disconnected))
  assert.equal(context.analyser.disconnected, true)
  await audio.shatter(67)
  assert.equal(calls().changes, changes)
  assert.deepEqual(audio.snapshot().effect, {
    active: false,
    pending: false,
    midi: null,
  })
})

await test('invalid or failed glass cues schedule nothing and explicit retry succeeds', async (t) => {
  const { audio, context, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  for (const midi of [NaN, Infinity, 23, 97]) {
    await audio.shatter(midi)
    assert.equal(calls().contexts, 0)
    assert.match(audio.snapshot().error ?? '', /playable pitch/)
    assert.equal(audio.snapshot().effect.pending, false)
  }
  context.resume = () => Promise.reject(new Error('Audio device unavailable.'))
  await audio.shatter(60)
  assert.equal(audio.snapshot().error, 'Audio device unavailable.')
  assert.equal(context.oscillators.length, 0)
  assert.equal(audio.snapshot().loading, false)
  context.resume = () => {
    context.state = 'running'
    return Promise.resolve()
  }
  await audio.shatter(64)
  assert.equal(audio.snapshot().error, null)
  assert.equal(audio.snapshot().effect.active, true)
  assert.equal(context.oscillators.length, 6)
  context.state = 'suspended'
  context.dispatchEvent(new Event('statechange'))
  assert.equal(audio.snapshot().effect.active, false)
  context.state = 'running'
  context.dispatchEvent(new Event('statechange'))
  assert.equal(context.oscillators.length, 6)
})

await test('the temple duet uses one transport with per-note timbre and gain, and finishes only at the last release', async (t) => {
  const { audio, context, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.playArrangement(TEMPLE_SCORE)
  assert.equal(calls().contexts, 1)
  assert.equal(context.oscillators.length, TEMPLE_SCORE.notes.length * 2)
  for (const [index, note] of TEMPLE_SCORE.notes.entries()) {
    const [first, partial] = context.oscillators.slice(index * 2, index * 2 + 2)
    const expectedStart = 0.025 + (note.beat * 60) / TEMPLE_SCORE.tempo
    const expectedEnd =
      expectedStart + (note.duration * 60) / TEMPLE_SCORE.tempo + 0.18
    assert.ok(Math.abs(first.startAt - expectedStart) < 1e-10)
    assert.ok(Math.abs(first.stopAt - expectedEnd) < 1e-10)
    assert.equal(first.type, note.timbre === 'reed' ? 'triangle' : 'sine')
    assert.equal(partial.type, 'sine')
    assert.equal(context.gains[index * 2 + 1].destination, context.gains[0])
    const weight = note.timbre === 'reed' ? 0.9 : 0.82
    assert.ok(
      Math.abs(
        Math.max(...context.gains[index * 2 + 1].gain.values) -
          0.11 * weight * note.gain,
      ) < 1e-10,
    )
  }
  context.currentTime = 0.025 + TEMPLE_DURATION_SECONDS / 2
  assert.ok(Math.abs(audio.snapshot().progress - 0.5) < 1e-10)
  assert.equal(audio.snapshot().motifId, TEMPLE_SCORE.id)
  const endings = [...context.oscillators].sort((a, b) => a.stopAt - b.stopAt)
  for (const voice of endings) {
    context.currentTime = voice.stopAt
    voice.onended?.()
    if (voice.stopAt < 0.025 + TEMPLE_DURATION_SECONDS - 0.001)
      assert.equal(audio.snapshot().playing, true)
  }
  const finished = audio.snapshot()
  assert.equal(finished.playing, false)
  assert.equal(finished.loading, false)
  assert.equal(finished.error, null)
  assert.equal(finished.motifId, TEMPLE_SCORE.id)
  assert.equal(finished.progress, 1)
  assert.equal(finished.level, 0)
  assert.ok(
    context.oscillators.every(
      (voice) => voice.disconnected && voice.onended === null,
    ),
  )
  audio.stop()
  assert.equal(audio.snapshot().progress, 0)
  assert.equal(audio.snapshot().motifId, null)
})

await test('a cancelled temple unlock never starts late or reports natural completion', async (t) => {
  for (const interruption of ['stop', 'hide', 'suspend', 'dispose'] as const) {
    await t.test(interruption, async (t) => {
      const { audio, context, visibility, calls } = fixture()
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
      const pending = audio.playArrangement(TEMPLE_SCORE)
      assert.equal(audio.snapshot().loading, true)
      if (interruption === 'stop') audio.stop()
      else if (interruption === 'hide') {
        visibility.hidden = true
        visibility.dispatchEvent(new Event('visibilitychange'))
      } else if (interruption === 'suspend')
        context.dispatchEvent(new Event('statechange'))
      else audio.dispose()
      const changes = calls().changes
      unlock()
      await pending
      assert.equal(calls().changes, changes)
      assert.equal(context.oscillators.length, 0)
      assert.equal(audio.snapshot().loading, false)
      assert.equal(audio.snapshot().progress, 0)
      assert.equal(audio.snapshot().motifId, null)
    })
  }
})

await test('temple playback replaces the old instrument, and a new motif cancels every future duet voice', async (t) => {
  const { audio, context, visibility, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  await audio.startTrace(62)
  const instrument = context.oscillators[0]
  context.currentTime = 1
  await audio.playArrangement(TEMPLE_SCORE)
  assert.equal(instrument.stopAt, 1.012)
  assert.equal(audio.snapshot().trace.active, false)
  const duet = context.oscillators.slice(1)
  context.currentTime = 2
  await audio.play(glass)
  assert.ok(duet.every((voice) => voice.stopAt === 2.012))
  assert.equal(audio.snapshot().motifId, glass.id)
  await audio.playArrangement(TEMPLE_SCORE)
  const replay = context.oscillators.slice(-TEMPLE_SCORE.notes.length * 2)
  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.ok(replay.every((voice) => voice.stopAt === 2.012))
  assert.equal(audio.snapshot().progress, 0)
  assert.equal(audio.snapshot().motifId, null)
  assert.equal(calls().contexts, 1)
})

await test('the transport copies an arrangement before unlocking and rejects invalid orchestration', async (t) => {
  const { audio, context, calls } = fixture()
  t.after(() => {
    audio.dispose()
  })
  for (const gain of [0, -1, 1.01, NaN, Infinity]) {
    await audio.playArrangement({
      ...TEMPLE_SCORE,
      notes: [{ ...TEMPLE_SCORE.notes[0], gain }],
    })
    assert.match(audio.snapshot().error ?? '', /playable score/)
    assert.equal(calls().contexts, 0)
  }
  const arrangement = {
    ...TEMPLE_SCORE,
    notes: TEMPLE_SCORE.notes.map((note) => ({ ...note })),
  }
  let unlock!: () => void
  context.resume = () =>
    new Promise<void>((resolve) => {
      unlock = () => {
        context.state = 'running'
        resolve()
      }
    })
  const pending = audio.playArrangement(arrangement)
  arrangement.notes[0].midi = 84
  arrangement.notes[0].gain = 1
  unlock()
  await pending
  assert.ok(
    Math.abs(context.oscillators[0].frequency.value - 261.6255653005986) <
      1e-10,
  )
  assert.ok(Math.max(...context.gains[1].gain.values) < 0.08)
})

await test('failed temple audio leaves a retryable error without a finished passage', async (t) => {
  const { audio, context } = fixture()
  t.after(() => {
    audio.dispose()
  })
  context.resume = () => Promise.reject(new Error('Audio device unavailable.'))
  await audio.playArrangement(TEMPLE_SCORE)
  assert.equal(audio.snapshot().error, 'Audio device unavailable.')
  assert.equal(audio.snapshot().progress, 0)
  assert.equal(audio.snapshot().motifId, null)
  assert.equal(context.oscillators.length, 0)
  context.resume = () => {
    context.state = 'running'
    return Promise.resolve()
  }
  await audio.playArrangement(TEMPLE_SCORE)
  assert.equal(audio.snapshot().error, null)
  assert.equal(audio.snapshot().playing, true)
  assert.equal(context.oscillators.length, 58)
})
