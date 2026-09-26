// User-initiated looping soundtrack with a shared audio clock and pause-safe analysis.
import { MusicAnalysis } from './audioAnalysis'

export { SILENT_MUSIC } from './audioAnalysis'
export type { MusicFrame } from './audioAnalysis'

export const TRACK = Object.freeze({
  title: 'Irchiinnuss · Arrival',
  credit: 'Original synthesized score · Lumen Apeiron',
  url: '/audio/irchiinnuss-arrival.ogg',
  duration: 48,
})

export interface AudioSnapshot {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error'
  elapsed: number
  duration: number
  volume: number
  muted: boolean
  error: string | null
}

interface AudioOptions {
  createContext?: () => AudioContext
  fetchTrack?: typeof fetch
  url?: string
}

interface Voice {
  source: AudioBufferSourceNode
  gain: GainNode
}

export class OrbAudio {
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private output: GainNode | null = null
  private buffer: AudioBuffer | null = null
  private loading: Promise<AudioBuffer> | null = null
  private pendingPlay: Promise<void> | null = null
  private abort: AbortController | null = null
  private voice: Voice | null = null
  private voices = new Set<Voice>()
  private waveform = new Float32Array(2048)
  private spectrum = new Float32Array(1024)
  private analysis = new MusicAnalysis()
  private status: AudioSnapshot['status'] = 'idle'
  private error: string | null = null
  private volume = 0.55
  private muted = false
  private offset = 0
  private startedAt = 0
  private sampledAt = 0
  private generation = 0
  private disposed = false

  constructor(private options: AudioOptions = {}) {}

  private clock() {
    return this.status === 'playing' && this.context
      ? this.offset + Math.max(0, this.context.currentTime - this.startedAt)
      : this.offset
  }

  private contextChanged = () => {
    if (this.status === 'playing' && this.context?.state !== 'running')
      this.pause()
  }

  private setup() {
    if (this.context) return this.context
    const context = this.options.createContext?.() ?? new AudioContext()
    this.context = context
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 2048
    // Our attack/release smoothing has a defined time constant across frame rates.
    this.analyser.smoothingTimeConstant = 0
    this.output = context.createGain()
    this.output.gain.value = this.muted ? 0 : this.volume
    this.analyser.connect(this.output)
    this.output.connect(context.destination)
    context.addEventListener('statechange', this.contextChanged)
    return context
  }

  private load(context: AudioContext) {
    if (this.buffer) return Promise.resolve(this.buffer)
    if (this.loading) return this.loading
    this.abort = new AbortController()
    const pending = (async () => {
      const response = await (this.options.fetchTrack ?? fetch)(
        this.options.url ?? TRACK.url,
        { signal: this.abort!.signal },
      )
      if (!response.ok)
        throw new Error(`Soundtrack download failed (${response.status}).`)
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      if (!Number.isFinite(buffer.duration) || buffer.duration < TRACK.duration)
        throw new Error('The soundtrack is shorter than its 48-second score.')
      if (!this.disposed) this.buffer = buffer
      return buffer
    })()
    this.loading = pending
    void pending
      .finally(() => {
        if (this.loading === pending) this.loading = null
      })
      .catch(() => {})
    return pending
  }

  play(): Promise<void> {
    if (this.disposed || this.status === 'playing') return Promise.resolve()
    if (this.status === 'loading' && this.pendingPlay) return this.pendingPlay
    const generation = ++this.generation
    this.status = 'loading'
    this.error = null
    // Create/resume synchronously in the click handler before any fetch await.
    const pending = (async () => {
      try {
        const context = this.setup()
        const [buffer] = await Promise.all([
          this.load(context),
          context.resume(),
        ])
        if (this.disposed || generation !== this.generation) return
        if (context.state !== 'running')
          throw new Error('Audio is suspended. Press Play to retry.')
        const source = context.createBufferSource()
        const gain = context.createGain()
        const voice = { source, gain }
        source.buffer = buffer
        source.loop = true
        // Chromium retains a 22 ms Vorbis tail beyond the known score length.
        source.loopEnd = TRACK.duration
        source.connect(gain)
        gain.connect(this.analyser!)
        gain.gain.setValueAtTime(0, context.currentTime)
        gain.gain.linearRampToValueAtTime(1, context.currentTime + 0.025)
        source.onended = () => {
          source.disconnect()
          gain.disconnect()
          this.voices.delete(voice)
        }
        source.start(0, this.offset % TRACK.duration)
        this.voice = voice
        this.voices.add(voice)
        this.startedAt = context.currentTime
        this.sampledAt = context.currentTime
        this.status = 'playing'
      } catch (error) {
        if (this.disposed || generation !== this.generation) return
        this.status = 'error'
        this.error = error instanceof Error ? error.message : String(error)
      }
    })()
    this.pendingPlay = pending
    return pending
  }

  pause() {
    if (this.disposed) return
    ++this.generation
    if (this.status === 'playing') {
      this.sample()
      this.offset = this.clock()
    }
    const voice = this.voice
    this.voice = null
    if (voice && this.context) {
      const time = this.context.currentTime
      voice.gain.gain.cancelScheduledValues(time)
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, time)
      voice.gain.gain.linearRampToValueAtTime(0, time + 0.025)
      voice.source.stop(time + 0.025)
    }
    if (this.status !== 'idle') this.status = 'paused'
  }

  restart() {
    this.pause()
    this.offset = 0
    this.analysis.reset()
    return this.play()
  }

  setVolume(value: number) {
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
    this.updateOutput()
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.updateOutput()
  }

  private updateOutput() {
    if (this.context && this.output)
      this.output.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.context.currentTime,
        0.02,
      )
  }

  sample() {
    if (this.status !== 'playing' || !this.context || !this.analyser)
      return this.analysis.frame
    const now = this.context.currentTime
    this.analyser.getFloatTimeDomainData(this.waveform)
    this.analyser.getFloatFrequencyData(this.spectrum)
    this.analysis.update(
      this.waveform,
      this.spectrum,
      this.context.sampleRate,
      this.clock(),
      now - this.sampledAt,
    )
    this.sampledAt = now
    return this.analysis.frame
  }

  snapshot(): AudioSnapshot {
    const duration = TRACK.duration
    return {
      status: this.status,
      elapsed: this.clock() % duration,
      duration,
      volume: this.volume,
      muted: this.muted,
      error: this.error,
    }
  }

  dispose() {
    if (this.disposed) return
    this.pause()
    this.disposed = true
    ++this.generation
    this.abort?.abort()
    for (const { source, gain } of this.voices) {
      source.onended = null
      source.disconnect()
      gain.disconnect()
    }
    this.voices.clear()
    this.analyser?.disconnect()
    this.output?.disconnect()
    if (this.context) {
      this.context.removeEventListener('statechange', this.contextChanged)
      void this.context.close().catch(() => {})
    }
    this.buffer = null
  }
}
