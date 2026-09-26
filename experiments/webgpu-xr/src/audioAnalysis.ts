// Bounded, frame-rate independent envelopes for the musical orb's immutable geometry.
export interface MusicFrame {
  time: number
  energy: number
  low: number
  mid: number
  high: number
}

export const SILENT_MUSIC: Readonly<MusicFrame> = Object.freeze({
  time: 0,
  energy: 0,
  low: 0,
  mid: 0,
  high: 0,
})

function unit(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function softKnee(value: number, halfResponse: number, floor: number) {
  const audible = Math.max(0, value - floor)
  return audible / (audible + halfResponse)
}

function signalPresence(rms: number) {
  // Absolute -60 dBFS gate, eased in by -48 dBFS. Quiet noise cannot normalize
  // itself into motion; a quiet musical section retains its lower intensity.
  const level = unit((rms - 0.001) / 0.003)
  return level * level * (3 - 2 * level)
}

export function smoothEnvelope(
  previous: number,
  target: number,
  seconds: number,
) {
  const start = unit(previous)
  const end = unit(target)
  const delta = Number.isFinite(seconds)
    ? Math.max(0, Math.min(0.25, seconds))
    : 0
  const duration = end > start ? 0.18 : 0.75
  return start + (end - start) * (1 - Math.exp(-delta / duration))
}

export class MusicAnalysis {
  readonly frame: MusicFrame = { ...SILENT_MUSIC }

  reset() {
    Object.assign(this.frame, SILENT_MUSIC)
  }

  update(
    waveform: Float32Array,
    spectrumDb: Float32Array,
    sampleRate: number,
    time: number,
    seconds: number,
  ) {
    let squares = 0
    for (const value of waveform)
      if (Number.isFinite(value)) squares += value * value
    const rms = Math.sqrt(squares / Math.max(1, waveform.length))
    const presence = signalPresence(rms)
    let low = 0
    let mid = 0
    let high = 0
    const binHz =
      Number.isFinite(sampleRate) && sampleRate > 0
        ? sampleRate / (spectrumDb.length * 2)
        : 0
    for (let bin = 0; bin < spectrumDb.length; bin++) {
      const frequency = bin * binHz
      const db = spectrumDb[bin]
      if (!Number.isFinite(db) || frequency < 40 || frequency >= 8000) continue
      const power = 10 ** (Math.min(0, db) / 10)
      if (frequency < 250) low += power
      else if (frequency < 2000) mid += power
      else high += power
    }
    // Fixed soft knees, calibrated against the full original score's measured
    // RMS-band medians: .0357 / .0360 / .00134 (2048-point Web Audio FFT).
    // No running gain control: these references do not chase quiet passages.
    const energy = presence * softKnee(rms, 0.12, 0.001)
    this.frame.time = Math.max(0, Number.isFinite(time) ? time : 0)
    this.frame.energy = smoothEnvelope(this.frame.energy, energy, seconds)
    this.frame.low = smoothEnvelope(
      this.frame.low,
      presence * softKnee(Math.sqrt(low), 0.04, 0.0001),
      seconds,
    )
    this.frame.mid = smoothEnvelope(
      this.frame.mid,
      presence * softKnee(Math.sqrt(mid), 0.04, 0.0001),
      seconds,
    )
    this.frame.high = smoothEnvelope(
      this.frame.high,
      presence * softKnee(Math.sqrt(high), 0.002, 0.0001),
      seconds,
    )
    return this.frame
  }
}
