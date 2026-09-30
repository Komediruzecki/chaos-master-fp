// Explicit one-shot motif auditions, with one playback owner and cancellation across audio unlocks.
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
    if (this.playing && this.context?.state !== 'running') this.stop()
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
    const now = this.context?.currentTime ?? 0
    for (const voice of this.voices) {
      const envelope = voice.gain.gain
      if (typeof envelope.cancelAndHoldAtTime === 'function')
        envelope.cancelAndHoldAtTime(now)
      else {
        const held = envelope.value
        envelope.cancelScheduledValues(now)
        envelope.setValueAtTime(held, now)
      }
      envelope.linearRampToValueAtTime(0, now + STOP_FADE)
      voice.oscillator.onended = () => {
        this.releaseVoice(voice)
      }
      voice.oscillator.stop(now + STOP_FADE)
    }
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
