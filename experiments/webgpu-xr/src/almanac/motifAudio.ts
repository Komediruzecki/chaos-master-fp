// Motifs, tracing and glass release cues share one audio owner and cancellable unlock.
import { SCORE_RELEASE_SECONDS } from '../journey/templeScore'
import { createWorldAmbience } from './worldAmbience'
import type { MotifArrangement } from '../journey/templeScore'
import type { AlmanacMotif } from './catalog'
import type { AmbienceWorldId } from './worldAmbience'

export interface MotifAudioSnapshot {
  playing: boolean
  loading: boolean
  motifId: string | null
  progress: number
  error: string | null
  volume: number
  activeNote: number | null
  level: number
  trace: {
    active: boolean
    pending: boolean
    midi: number | null
    accentMidi: number | null
  }
  effect: {
    active: boolean
    pending: boolean
    midi: number | null
  }
  ambience: {
    enabled: boolean
    active: boolean
    pending: boolean
    worldId: AmbienceWorldId | null
    cueActive: boolean
    ducked: boolean
  }
}

interface AudioOptions {
  createContext?: () => AudioContext
  visibility?: Pick<
    Document,
    'hidden' | 'addEventListener' | 'removeEventListener'
  >
}

interface Voice {
  oscillator: OscillatorNode
  gain: GainNode
}

/** A short earned response uses the trace owner, never a second transport. */
export interface TraceResolutionNote {
  midi: number
  offset: number
  duration: number
  gain: number
}

const STOP_FADE = 0.012
const START_DELAY = 0.025
const TRACE_ATTACK = 0.025
const TRACE_GLIDE = 0.025
const TRACE_GAIN = 0.045
const TRACE_ACCENT_PARTIALS = [
  { ratio: 1, gain: 0.048, duration: 0.31 },
  { ratio: 2, gain: 0.012, duration: 0.19 },
] as const
// Six inharmonic sine partials suggest glass without a noise burst or sharp attack.
const GLASS_PARTIALS = [
  [1, 0.03, 1.15],
  [1.479, 0.022, 0.96],
  [2.093, 0.016, 0.78],
  [2.779, 0.012, 0.64],
  [4.091, 0.008, 0.48],
  [5.431, 0.005, 0.35],
] as const
const midiFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const validMidi = (midi: number) =>
  Number.isFinite(midi) && midi >= 24 && midi <= 96

export class MotifAudio {
  private context: AudioContext | null = null
  private output: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private waveform = new Float32Array(256)
  private voices = new Set<Voice>()
  private timer: ReturnType<typeof setInterval> | null = null
  private motif: MotifArrangement | null = null
  private playing = false
  private loading = false
  private volume = 0.55
  private progress = 0
  private error: string | null = null
  private startedAt = 0
  private endsAt = 0
  private generation = 0
  private disposed = false
  private traceRequested = false
  private traceVoice: Voice | null = null
  private traceCues = new Set<Voice>()
  private traceMidi: number | null = null
  private traceAccentMidi: number | null = null
  private traceStartsAt = 0
  private effectVoices = new Set<Voice>()
  private effectPending = false
  private effectMidi: number | null = null
  private ambience: ReturnType<typeof createWorldAmbience> | null = null
  private retiringAmbience: ReturnType<typeof createWorldAmbience> | null = null
  private ambienceEnabled = false
  private ambiencePending = false
  private ambienceWorld: AmbienceWorldId | null = null
  private ambienceGeneration = 0
  private visibility: AudioOptions['visibility']

  constructor(
    private changed: () => void,
    private options: AudioOptions = {},
  ) {
    this.visibility =
      options.visibility ??
      (typeof document === 'undefined' ? undefined : document)
    this.visibility?.addEventListener(
      'visibilitychange',
      this.visibilityChanged,
    )
  }

  private visibilityChanged = () => {
    if (this.visibility?.hidden) this.stop()
  }

  private contextChanged = () => {
    if (
      (this.playing ||
        this.loading ||
        this.traceRequested ||
        this.traceVoice ||
        this.traceCues.size > 0 ||
        this.effectPending ||
        this.effectVoices.size > 0 ||
        this.ambienceEnabled ||
        this.ambiencePending) &&
      this.context?.state !== 'running'
    )
      this.stop()
  }

  private setup() {
    if (this.context) return this.context
    const context = this.options.createContext?.() ?? new AudioContext()
    this.context = context
    this.output = context.createGain()
    this.output.gain.value = this.volume
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = this.waveform.length
    // The shared master follows the musical meter; ambience bypasses that meter.
    this.analyser.connect(this.output)
    this.output.connect(context.destination)
    context.addEventListener('statechange', this.contextChanged)
    return context
  }

  /** Only an explicit sound gesture may create or resume the shared context. */
  async setAmbience(worldId: AmbienceWorldId, enabled: boolean): Promise<void> {
    if (this.disposed) return
    if (!enabled) {
      this.stopAmbience()
      return
    }
    this.ambienceWorld = worldId
    if (this.ambienceEnabled && (this.ambience || this.ambiencePending)) {
      this.changeAmbience(worldId)
      return
    }
    this.ambienceEnabled = true
    this.ambiencePending = true
    const generation = ++this.ambienceGeneration
    this.error = null
    this.changed()
    try {
      if (this.visibility?.hidden) {
        this.stopAmbience()
        return
      }
      const context = this.setup()
      await context.resume()
      if (this.disposed || generation !== this.ambienceGeneration) return
      if (this.visibility?.hidden) {
        this.stopAmbience()
        return
      }
      if (context.state !== 'running')
        throw new Error('Audio is suspended. Enable ambience to retry.')
      this.ambience = createWorldAmbience(
        context,
        this.output!,
        this.ambienceWorld,
        this.changed,
      )
      this.ambiencePending = false
      this.refreshAmbienceDuck()
      this.changed()
    } catch (error) {
      if (this.disposed || generation !== this.ambienceGeneration) return
      this.stopAmbience()
      this.error = error instanceof Error ? error.message : String(error)
      this.changed()
    }
  }

  /** Navigation may reshape an opted-in soundscape, but cannot unlock sound. */
  changeAmbience(worldId: AmbienceWorldId, cue = false) {
    if (this.disposed || !this.ambienceEnabled) return
    this.ambienceWorld = worldId
    if (this.context?.state !== 'running' || this.visibility?.hidden) return
    this.ambience?.setWorld(worldId)
    if (cue) this.ambience?.cue()
    else this.ambience?.stopCue()
    this.changed()
  }

  stopAmbience() {
    if (this.disposed) return
    ++this.ambienceGeneration
    this.retiringAmbience?.dispose(true)
    this.retiringAmbience = this.ambience
    this.ambience?.dispose()
    this.ambience = null
    this.ambienceEnabled = false
    this.ambiencePending = false
    this.ambienceWorld = null
    this.changed()
  }

  private refreshAmbienceDuck() {
    this.ambience?.setDucked(
      Boolean(
        this.playing || this.loading || this.traceRequested || this.voices.size,
      ),
    )
  }

  /** Unlock now; a bounded lead-in can let the destination settle before its phrase. */
  play(motif: AlmanacMotif, leadInSeconds = 0): Promise<void> {
    return this.playScore(
      {
        id: motif.id,
        tempo: motif.tempo,
        notes: motif.notes.map((note) => ({
          ...note,
          timbre: motif.timbre,
          gain: 1,
        })),
      },
      leadInSeconds,
    )
  }

  /** An explicit gesture starts one passage through the existing audio owner. */
  playArrangement(arrangement: MotifArrangement): Promise<void> {
    return this.playScore({
      ...arrangement,
      notes: arrangement.notes.map((note) => ({ ...note })),
    })
  }

  private async playScore(
    motif: MotifArrangement,
    leadInSeconds = 0,
  ): Promise<void> {
    if (this.disposed) return
    this.stopInstrument()
    const generation = ++this.generation
    this.motif = motif
    this.loading = true
    this.error = null
    this.refreshAmbienceDuck()
    this.changed()
    try {
      if (
        !Number.isFinite(motif.tempo) ||
        motif.tempo < 30 ||
        motif.tempo > 240 ||
        motif.notes.length === 0 ||
        motif.notes.length > 64 ||
        motif.notes.some(
          (note) =>
            !Number.isInteger(note.midi) ||
            note.midi < 24 ||
            note.midi > 96 ||
            !Number.isFinite(note.beat) ||
            note.beat < 0 ||
            note.beat > 64 ||
            !Number.isFinite(note.duration) ||
            note.duration <= 0 ||
            note.duration > 8 ||
            (note.timbre !== 'glass' && note.timbre !== 'reed') ||
            !Number.isFinite(note.gain) ||
            note.gain <= 0 ||
            note.gain > 1,
        )
      )
        throw new Error('This motif has no playable score.')
      // Keep context creation and resume inside the original button gesture.
      const context = this.setup()
      await context.resume()
      if (this.disposed || generation !== this.generation) return
      if (this.visibility?.hidden) {
        this.stop()
        return
      }
      if (context.state !== 'running')
        throw new Error('Audio is suspended. Press Play to retry.')
      const beatSeconds = 60 / motif.tempo
      const leadIn = Number.isFinite(leadInSeconds)
        ? Math.max(0, Math.min(0.8, leadInSeconds))
        : 0
      this.startedAt = context.currentTime + START_DELAY + leadIn
      this.endsAt =
        this.startedAt +
        Math.max(
          ...motif.notes.map(
            (note) => (note.beat + note.duration) * beatSeconds,
          ),
        ) +
        SCORE_RELEASE_SECONDS
      motif.notes.forEach((note) => {
        const start = this.startedAt + note.beat * beatSeconds
        const end = start + note.duration * beatSeconds
        const frequency = 440 * 2 ** ((note.midi - 69) / 12)
        const partials =
          note.timbre === 'glass'
            ? [
                [1, 0.82],
                [2.76, 0.18],
              ]
            : [
                [1, 0.9],
                [2, 0.1],
              ]
        partials.forEach(([ratio, weight], index) => {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          const voice = { oscillator, gain }
          this.voices.add(voice)
          oscillator.type =
            note.timbre === 'reed' && index === 0 ? 'triangle' : 'sine'
          oscillator.frequency.setValueAtTime(frequency * ratio, start)
          oscillator.connect(gain)
          gain.connect(this.analyser!)
          const peak = 0.11 * weight * note.gain
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(
            peak,
            start + (note.timbre === 'glass' ? 0.007 : 0.045),
          )
          gain.gain.exponentialRampToValueAtTime(
            peak * (note.timbre === 'glass' ? 0.12 : 0.6),
            end,
          )
          gain.gain.linearRampToValueAtTime(0, end + SCORE_RELEASE_SECONDS)
          oscillator.onended = () => {
            this.releaseVoice(voice)
            if (
              !this.disposed &&
              generation === this.generation &&
              context.currentTime >= this.endsAt - 0.001
            )
              this.finish()
          }
          oscillator.start(start)
          oscillator.stop(end + SCORE_RELEASE_SECONDS)
        })
      })
      this.loading = false
      this.playing = true
      this.timer = setInterval(() => {
        if (context.currentTime >= this.endsAt) this.finish()
        else this.changed()
      }, 50)
      this.changed()
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      this.stopInstrument()
      this.error = error instanceof Error ? error.message : String(error)
      this.changed()
    }
  }

  private releaseVoice(voice: Voice) {
    voice.oscillator.onended = null
    voice.oscillator.disconnect()
    voice.gain.disconnect()
    this.voices.delete(voice)
    const wasEffect = this.effectVoices.delete(voice)
    if (!this.effectVoices.size && !this.effectPending) this.effectMidi = null
    const wasCue = this.traceCues.delete(voice)
    const wasTrace = voice === this.traceVoice || wasCue
    if (voice === this.traceVoice) this.traceVoice = null
    if (wasCue && !this.traceCues.size) this.traceAccentMidi = null
    if (!this.traceVoice && !this.traceCues.size && !this.traceRequested)
      this.traceMidi = null
    this.refreshAmbienceDuck()
    if ((wasTrace || wasEffect || this.ambience) && !this.disposed)
      this.changed()
  }

  /** An explicit earned release replaces the instrument with one bounded glass cue. */
  async shatter(midi: number): Promise<void> {
    if (this.disposed) return
    this.stopInstrument()
    const generation = ++this.generation
    this.effectPending = true
    this.effectMidi = midi
    this.loading = true
    this.refreshAmbienceDuck()
    this.changed()
    try {
      if (!validMidi(midi)) throw new Error('This seal has no playable pitch.')
      const context = this.setup()
      await context.resume()
      if (
        this.disposed ||
        generation !== this.generation ||
        !this.effectPending
      )
        return
      if (this.visibility?.hidden) {
        this.stop()
        return
      }
      if (context.state !== 'running')
        throw new Error('Audio is suspended. Release another seal to retry.')
      const start = context.currentTime + START_DELAY
      GLASS_PARTIALS.forEach(([ratio, peak, duration], index) => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const voice = { oscillator, gain }
        this.voices.add(voice)
        this.effectVoices.add(voice)
        const at = start + index * 0.003
        const end = at + duration
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(midiFrequency(midi) * ratio, at)
        oscillator.connect(gain)
        gain.connect(this.analyser!)
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime(peak, at + 0.008)
        gain.gain.exponentialRampToValueAtTime(0.0001, end - 0.04)
        gain.gain.linearRampToValueAtTime(0, end)
        oscillator.onended = () => {
          this.releaseVoice(voice)
        }
        oscillator.start(at)
        oscillator.stop(end + 0.01)
      })
      this.effectPending = false
      this.loading = false
      this.changed()
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      this.stopInstrument()
      this.error = error instanceof Error ? error.message : String(error)
      this.changed()
    }
  }

  /** Called only from an explicit pointer press or keyboard drawing gesture. */
  async startTrace(midi: number, earnedMidi?: number): Promise<void> {
    if (this.disposed) return
    this.stopInstrument()
    const generation = ++this.generation
    this.traceRequested = true
    this.traceMidi = midi
    this.traceAccentMidi = earnedMidi ?? null
    this.loading = true
    this.refreshAmbienceDuck()
    this.changed()
    try {
      if (
        !validMidi(midi) ||
        (earnedMidi !== undefined && !validMidi(earnedMidi))
      )
        throw new Error('This trace has no playable pitch.')
      const context = this.setup()
      await context.resume()
      if (
        this.disposed ||
        generation !== this.generation ||
        !this.traceRequested
      )
        return
      if (this.visibility?.hidden) {
        this.stop()
        return
      }
      if (context.state !== 'running')
        throw new Error('Audio is suspended. Start a new trace to retry.')
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const voice = { oscillator, gain }
      this.traceVoice = voice
      this.voices.add(voice)
      const start = context.currentTime + START_DELAY
      this.traceStartsAt = start
      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(
        midiFrequency(this.traceMidi ?? midi),
        start,
      )
      oscillator.connect(gain)
      gain.connect(this.analyser!)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(TRACE_GAIN, start + TRACE_ATTACK)
      oscillator.onended = () => {
        this.releaseVoice(voice)
      }
      oscillator.start(start)
      this.loading = false
      if (this.traceAccentMidi !== null)
        this.accentTrace(this.traceAccentMidi, start)
      this.changed()
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      this.stopInstrument()
      this.error = error instanceof Error ? error.message : String(error)
      this.changed()
    }
  }

  /** Movement never starts audio; a cancelled gesture requires a fresh startTrace. */
  updateTrace(midi: number, earnedMidi?: number) {
    if (this.disposed || !this.traceRequested) return
    if (
      !validMidi(midi) ||
      (earnedMidi !== undefined && !validMidi(earnedMidi))
    ) {
      this.stopTrace()
      return
    }
    this.traceMidi = midi
    if (earnedMidi !== undefined) this.traceAccentMidi = earnedMidi
    if (this.context && this.traceVoice) {
      const at = Math.max(this.context.currentTime, this.traceStartsAt)
      this.traceVoice.oscillator.frequency.setTargetAtTime(
        midiFrequency(midi),
        at,
        TRACE_GLIDE,
      )
      if (earnedMidi !== undefined) this.accentTrace(earnedMidi, at)
    }
    this.changed()
  }

  private accentTrace(midi: number, start = this.context?.currentTime ?? 0) {
    if (!this.context || !this.output) return
    for (const voice of this.traceCues) this.fadeVoice(voice)
    this.traceAccentMidi = midi
    for (const partial of TRACE_ACCENT_PARTIALS)
      this.scheduleTraceCue(
        midiFrequency(midi) * partial.ratio,
        start,
        partial.duration,
        partial.gain,
      )
  }

  private scheduleTraceCue(
    frequency: number,
    start: number,
    duration: number,
    peak: number,
  ) {
    if (!this.context || !this.output) return
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    const voice = { oscillator, gain }
    this.traceCues.add(voice)
    this.voices.add(voice)
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)
    oscillator.connect(gain)
    gain.connect(this.analyser!)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(peak, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration - 0.04)
    gain.gain.linearRampToValueAtTime(0, start + duration)
    oscillator.onended = () => {
      this.releaseVoice(voice)
    }
    oscillator.start(start)
    oscillator.stop(start + duration + 0.01)
  }

  /** Completion leaves a short confirmation; cancellation, blur or stop can cut it short. */
  finishTrace(earnedMidi: number, resolution?: readonly TraceResolutionNote[]) {
    if (
      !validMidi(earnedMidi) ||
      (resolution !== undefined &&
        (resolution.length === 0 ||
          resolution.length > 8 ||
          resolution.some(
            (note) =>
              !Number.isInteger(note.midi) ||
              !validMidi(note.midi) ||
              !Number.isFinite(note.offset) ||
              note.offset < 0 ||
              note.offset > 1 ||
              !Number.isFinite(note.duration) ||
              note.duration < 0.08 ||
              note.duration > 1.5 ||
              !Number.isFinite(note.gain) ||
              note.gain <= 0 ||
              note.gain > 0.065,
          )))
    ) {
      this.stopTrace()
      return
    }
    if (!this.traceVoice || !this.context || !this.traceRequested) {
      this.stopTrace()
      return
    }
    this.updateTrace(earnedMidi, resolution ? undefined : earnedMidi)
    if (resolution) {
      for (const voice of this.traceCues) this.fadeVoice(voice)
      const start = Math.max(this.context.currentTime, this.traceStartsAt)
      this.traceAccentMidi = earnedMidi
      for (const note of resolution)
        this.scheduleTraceCue(
          midiFrequency(note.midi),
          start + note.offset,
          note.duration,
          note.gain,
        )
    }
    this.traceRequested = false
    this.fadeVoice(this.traceVoice, 0.08)
    this.changed()
  }

  stopTrace() {
    if (this.traceRequested || this.traceVoice || this.traceCues.size)
      this.stopInstrument()
  }

  private fadeVoice(voice: Voice, duration = STOP_FADE) {
    const now = this.context?.currentTime ?? 0
    const envelope = voice.gain.gain
    if (typeof envelope.cancelAndHoldAtTime === 'function')
      envelope.cancelAndHoldAtTime(now)
    else {
      const held = envelope.value
      envelope.cancelScheduledValues(now)
      envelope.setValueAtTime(held, now)
    }
    envelope.linearRampToValueAtTime(0, now + duration)
    voice.oscillator.onended = () => {
      this.releaseVoice(voice)
    }
    voice.oscillator.stop(now + duration)
  }

  private clearTimer() {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  private finish() {
    if (!this.playing) return
    this.playing = false
    this.loading = false
    this.progress = 1
    this.clearTimer()
    this.refreshAmbienceDuck()
    this.changed()
  }

  /** Encounter release and replay silence the instrument without revoking ambience. */
  stopInstrument() {
    if (this.disposed) return
    ++this.generation
    this.clearTimer()
    this.playing = false
    this.loading = false
    this.motif = null
    this.progress = 0
    this.error = null
    this.traceRequested = false
    this.traceVoice = null
    this.traceCues.clear()
    this.traceMidi = null
    this.traceAccentMidi = null
    this.effectPending = false
    this.effectMidi = null
    this.effectVoices.clear()
    for (const voice of this.voices) this.fadeVoice(voice)
    this.refreshAmbienceDuck()
    this.changed()
  }

  /** Emergency, hidden-tab and modal stop always revoke the ambient session too. */
  stop() {
    if (this.disposed) return
    this.stopInstrument()
    this.stopAmbience()
  }

  setVolume(value: number) {
    if (this.disposed) return
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
    if (this.context && this.output)
      this.output.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.02,
      )
    this.changed()
  }

  snapshot(): MotifAudioSnapshot {
    let activeNote: number | null = null
    let level = 0
    let progress = this.progress
    if (this.playing && this.context && this.motif) {
      const elapsed = this.context.currentTime - this.startedAt
      progress = Math.max(
        0,
        Math.min(1, elapsed / (this.endsAt - this.startedAt)),
      )
      const beat = (elapsed * this.motif.tempo) / 60
      const index = this.motif.notes.findIndex(
        (note) => beat >= note.beat && beat < note.beat + note.duration,
      )
      activeNote = index === -1 ? null : index
    }
    if (
      this.playing ||
      this.traceVoice ||
      this.traceCues.size > 0 ||
      this.effectVoices.size > 0
    ) {
      this.analyser?.getFloatTimeDomainData(this.waveform)
      level = Math.min(
        1,
        8 *
          this.volume *
          Math.sqrt(
            this.waveform.reduce((sum, sample) => sum + sample * sample, 0) /
              this.waveform.length,
          ),
      )
    }
    return {
      playing: this.playing,
      loading: this.loading,
      motifId: this.motif?.id ?? null,
      progress,
      error: this.error,
      volume: this.volume,
      activeNote,
      level,
      trace: {
        active: Boolean(this.traceVoice || this.traceCues.size),
        pending: this.traceRequested && this.loading,
        midi: this.traceMidi,
        accentMidi: this.traceAccentMidi,
      },
      effect: {
        active: this.effectVoices.size > 0,
        pending: this.effectPending,
        midi: this.effectMidi,
      },
      ambience: {
        enabled: this.ambienceEnabled,
        active: Boolean(this.ambience && this.context?.state === 'running'),
        pending: this.ambiencePending,
        worldId: this.ambienceWorld,
        cueActive: this.ambience?.snapshot().cueActive ?? false,
        ducked: this.ambience?.snapshot().ducked ?? false,
      },
    }
  }

  dispose() {
    if (this.disposed) return
    this.stop()
    this.retiringAmbience?.dispose(true)
    this.retiringAmbience = null
    this.disposed = true
    this.visibility?.removeEventListener(
      'visibilitychange',
      this.visibilityChanged,
    )
    for (const voice of this.voices) this.releaseVoice(voice)
    this.output?.disconnect()
    this.analyser?.disconnect()
    if (this.context) {
      this.context.removeEventListener('statechange', this.contextChanged)
      void this.context.close().catch(() => {})
    }
  }
}
