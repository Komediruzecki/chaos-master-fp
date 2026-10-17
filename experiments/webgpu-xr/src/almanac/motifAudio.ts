// Motifs, tracing and glass release cues share one audio owner and cancellable unlock.
import type { AlmanacMotif } from './catalog'

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

const RELEASE = 0.18
const STOP_FADE = 0.012
const START_DELAY = 0.025
const TRACE_ATTACK = 0.025
const TRACE_GLIDE = 0.025
const TRACE_GAIN = 0.045
const ACCENT_GAIN = 0.065
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
  private motif: AlmanacMotif | null = null
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
  private traceAccent: Voice | null = null
  private traceMidi: number | null = null
  private traceAccentMidi: number | null = null
  private traceStartsAt = 0
  private effectVoices = new Set<Voice>()
  private effectPending = false
  private effectMidi: number | null = null
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
        this.traceRequested ||
        this.traceVoice ||
        this.traceAccent ||
        this.effectPending ||
        this.effectVoices.size > 0) &&
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
    this.output.connect(this.analyser)
    this.analyser.connect(context.destination)
    context.addEventListener('statechange', this.contextChanged)
    return context
  }

  async play(motif: AlmanacMotif): Promise<void> {
    if (this.disposed) return
    this.stop()
    const generation = ++this.generation
    this.motif = motif
    this.loading = true
    this.error = null
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
            note.duration > 8,
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
      this.startedAt = context.currentTime + START_DELAY
      this.endsAt =
        this.startedAt +
        Math.max(
          ...motif.notes.map(
            (note) => (note.beat + note.duration) * beatSeconds,
          ),
        ) +
        RELEASE
      motif.notes.forEach((note) => {
        const start = this.startedAt + note.beat * beatSeconds
        const end = start + note.duration * beatSeconds
        const frequency = 440 * 2 ** ((note.midi - 69) / 12)
        const partials =
          motif.timbre === 'glass'
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
            motif.timbre === 'reed' && index === 0 ? 'triangle' : 'sine'
          oscillator.frequency.setValueAtTime(frequency * ratio, start)
          oscillator.connect(gain)
          gain.connect(this.output!)
          const peak = 0.11 * weight
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(
            peak,
            start + (motif.timbre === 'glass' ? 0.007 : 0.045),
          )
          gain.gain.exponentialRampToValueAtTime(
            peak * (motif.timbre === 'glass' ? 0.12 : 0.6),
            end,
          )
          gain.gain.linearRampToValueAtTime(0, end + RELEASE)
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
          oscillator.stop(end + RELEASE)
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
      this.stop()
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
    const wasTrace = voice === this.traceVoice || voice === this.traceAccent
    if (voice === this.traceVoice) this.traceVoice = null
    if (voice === this.traceAccent) {
      this.traceAccent = null
      this.traceAccentMidi = null
    }
    if (!this.traceVoice && !this.traceAccent && !this.traceRequested)
      this.traceMidi = null
    if ((wasTrace || wasEffect) && !this.disposed) this.changed()
  }

  /** An explicit earned release replaces the instrument with one bounded glass cue. */
  async shatter(midi: number): Promise<void> {
    if (this.disposed) return
    this.stop()
    const generation = ++this.generation
    this.effectPending = true
    this.effectMidi = midi
    this.loading = true
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
        gain.connect(this.output!)
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
      this.stop()
      this.error = error instanceof Error ? error.message : String(error)
      this.changed()
    }
  }

  /** Called only from an explicit pointer press or keyboard drawing gesture. */
  async startTrace(midi: number, earnedMidi?: number): Promise<void> {
    if (this.disposed) return
    this.stop()
    const generation = ++this.generation
    this.traceRequested = true
    this.traceMidi = midi
    this.traceAccentMidi = earnedMidi ?? null
    this.loading = true
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
      gain.connect(this.output!)
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
      this.stop()
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
    if (this.traceAccent) this.fadeVoice(this.traceAccent)
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    const voice = { oscillator, gain }
    this.traceAccent = voice
    this.traceAccentMidi = midi
    this.voices.add(voice)
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(midiFrequency(midi), start)
    oscillator.connect(gain)
    gain.connect(this.output)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(ACCENT_GAIN, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18)
    gain.gain.linearRampToValueAtTime(0, start + 0.23)
    oscillator.onended = () => {
      this.releaseVoice(voice)
    }
    oscillator.start(start)
    oscillator.stop(start + 0.24)
  }

  /** Completion leaves one short confirmation; lift, blur or stop still cancels it. */
  finishTrace(earnedMidi: number) {
    if (!validMidi(earnedMidi)) {
      this.stopTrace()
      return
    }
    if (!this.traceVoice || !this.context || !this.traceRequested) {
      this.stopTrace()
      return
    }
    this.updateTrace(earnedMidi, earnedMidi)
    this.traceRequested = false
    this.fadeVoice(this.traceVoice, 0.08)
    this.changed()
  }

  stopTrace() {
    if (this.traceRequested || this.traceVoice || this.traceAccent) this.stop()
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
    this.changed()
  }

  stop() {
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
    this.traceAccent = null
    this.traceMidi = null
    this.traceAccentMidi = null
    this.effectPending = false
    this.effectMidi = null
    this.effectVoices.clear()
    for (const voice of this.voices) this.fadeVoice(voice)
    this.changed()
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
      this.traceAccent ||
      this.effectVoices.size > 0
    ) {
      this.analyser?.getFloatTimeDomainData(this.waveform)
      level = Math.min(
        1,
        8 *
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
        active: Boolean(this.traceVoice || this.traceAccent),
        pending: this.traceRequested && this.loading,
        midi: this.traceMidi,
        accentMidi: this.traceAccentMidi,
      },
      effect: {
        active: this.effectVoices.size > 0,
        pending: this.effectPending,
        midi: this.effectMidi,
      },
    }
  }

  dispose() {
    if (this.disposed) return
    this.stop()
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
