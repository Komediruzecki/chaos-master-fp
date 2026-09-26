// Pin envelope timing and spectral bands so music never introduces unbounded geometry.
import assert from 'node:assert/strict'
import test from 'node:test'
import { MusicAnalysis, SILENT_MUSIC, smoothEnvelope, } from '../src/audioAnalysis'

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
}

await test('attack and release use distinct, frame-rate independent time constants', () => {
  close(smoothEnvelope(0, 1, 0.18), 1 - Math.exp(-1))
  close(smoothEnvelope(1, 0, 0.25), Math.exp(-1 / 3))
  const whole = smoothEnvelope(0, 0.7, 0.1)
  const halves = smoothEnvelope(smoothEnvelope(0, 0.7, 0.05), 0.7, 0.05)
  close(whole, halves)
  close(smoothEnvelope(0.5, 1, 0), 0.5)
  close(smoothEnvelope(0.5, 1, 20), smoothEnvelope(0.5, 1, 0.25))
  for (const fps of [30, 60, 72, 90, 120]) {
    let value = 0
    for (let frame = 0; frame < fps; frame++)
      value = smoothEnvelope(value, 0.7, 1 / fps)
    close(value, 0.7 * (1 - Math.exp(-1 / 0.18)))
    for (let frame = 0; frame < fps; frame++)
      value = smoothEnvelope(value, 0, 1 / fps)
    close(value, 0.7 * (1 - Math.exp(-1 / 0.18)) * Math.exp(-1 / 0.75))
  }
})

await test('RMS and independent low, mid and high bands react to actual samples', () => {
  const analysis = new MusicAnalysis()
  const waveform = new Float32Array(2048).fill(0.1)
  const spectrum = new Float32Array(1024).fill(-Infinity)
  spectrum[10] = -20 // 156.25 Hz
  spectrum[64] = -20 // 1 kHz
  spectrum[256] = -20 // 4 kHz
  spectrum[0] = 0 // DC is excluded.
  spectrum[600] = 0 // Above 8 kHz is excluded.
  const result = analysis.update(waveform, spectrum, 32000, 3, 0.18)
  close(result.energy, (0.099 / 0.219) * (1 - Math.exp(-1)))
  close(result.low, (0.0999 / 0.1399) * (1 - Math.exp(-1)))
  close(result.mid, (0.0999 / 0.1399) * (1 - Math.exp(-1)))
  close(result.high, (0.0999 / 0.1019) * (1 - Math.exp(-1)))
  assert.equal(result.time, 3)
  spectrum.fill(-Infinity)
  waveform.fill(0)
  const before = { ...result }
  assert.equal(analysis.update(waveform, spectrum, 32000, 3.25, 0.25), result)
  close(result.energy, before.energy * Math.exp(-1 / 3))
  close(result.high, before.high * Math.exp(-1 / 3))
  analysis.reset()
  assert.deepEqual(result, SILENT_MUSIC)
})

await test('bin-centered tones only move the corresponding spectral band', () => {
  for (const [bin, band, reference] of [
    [10, 'low', 0.04],
    [64, 'mid', 0.04],
    [256, 'high', 0.002],
  ] as const) {
    const waveform = Float32Array.from(
      { length: 2048 },
      (_, sample) => 0.2 * Math.sin((2 * Math.PI * bin * sample) / 2048),
    )
    // The ideal DFT of a bin-centered sine has amplitude A/2 at this bin.
    // This fixture tests band routing; the browser harness measures windowing.
    const spectrum = new Float32Array(1024).fill(-Infinity)
    spectrum[bin] = -20
    const result = new MusicAnalysis().update(
      waveform,
      spectrum,
      32000,
      0,
      0.18,
    )
    const rms = Math.SQRT1_2 * 0.2
    close(
      result.energy,
      ((rms - 0.001) / (rms - 0.001 + 0.12)) * (1 - Math.exp(-1)),
    )
    for (const key of ['low', 'mid', 'high'] as const)
      close(
        result[key],
        key === band ? (0.0999 / (0.0999 + reference)) * (1 - Math.exp(-1)) : 0,
      )
  }
})

await test('absolute silence gate suppresses quiet noise even with spectral outliers', () => {
  const analysis = new MusicAnalysis()
  const noise = Float32Array.from({ length: 2048 }, (_, index) =>
    index % 2 ? 0.0009 : -0.0009,
  )
  const spectrum = new Float32Array(1024).fill(-70)
  spectrum[80] = -10
  for (let frame = 0; frame < 80; frame++)
    analysis.update(noise, spectrum, 32000, 0, 0.25)
  assert.deepEqual(analysis.frame, SILENT_MUSIC)

  noise.fill(0.0025)
  spectrum.fill(-Infinity)
  spectrum[10] = -20
  const eased = analysis.update(noise, spectrum, 32000, 0, 0.18)
  close(eased.low, 0.5 * (0.0999 / 0.1399) * (1 - Math.exp(-1)))
})

await test('fixed response preserves a long quiet passage instead of gaining it back up', () => {
  const analysis = new MusicAnalysis()
  const waveform = new Float32Array(2048)
  const spectrum = new Float32Array(1024).fill(-Infinity)
  const section = (gain: number) => {
    waveform.fill(0.14 * gain)
    for (const [bin, amplitude] of [
      [10, 0.04],
      [64, 0.035],
      [256, 0.0015],
    ])
      spectrum[bin] = 20 * Math.log10(amplitude * gain)
    for (let frame = 0; frame < 80; frame++)
      analysis.update(waveform, spectrum, 32000, 0, 0.25)
    return { ...analysis.frame }
  }
  const loud = section(1)
  const quiet = section(0.1)
  close(quiet.energy, 0.013 / 0.133)
  close(quiet.low, 0.0039 / 0.0439)
  close(quiet.mid, 0.0034 / 0.0434)
  close(quiet.high, 0.00005 / 0.00205)
  for (const key of ['energy', 'low', 'mid', 'high'] as const)
    assert.ok(quiet[key] < loud[key] / 4, `${key} must preserve quiet dynamics`)
  const sustainedQuiet = section(0.1)
  for (const key of ['energy', 'low', 'mid', 'high'] as const)
    close(sustainedQuiet[key], quiet[key])
})

await test('silence, empty arrays, invalid samples and extreme levels remain finite and bounded', () => {
  const analysis = new MusicAnalysis()
  assert.deepEqual(
    analysis.update(new Float32Array(0), new Float32Array(0), 32000, 0, 1),
    SILENT_MUSIC,
  )
  const waveform = new Float32Array([NaN, Infinity, 1000, -1000])
  const spectrum = new Float32Array([
    NaN,
    Infinity,
    1000,
    1000,
    -Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ])
  const frame = analysis.update(waveform, spectrum, 32000, NaN, 0.25)
  assert.equal(frame.time, 0)
  const rms = Math.SQRT1_2 * 1000 - 0.001
  close(frame.energy, (rms / (rms + 0.12)) * (1 - Math.exp(-0.25 / 0.18)))
  const amplitude = Math.SQRT2 - 0.0001
  close(
    frame.high,
    (amplitude / (amplitude + 0.002)) * (1 - Math.exp(-0.25 / 0.18)),
  )
  assert.equal(frame.low, 0)
  assert.equal(frame.mid, 0)
  close(smoothEnvelope(NaN, Infinity, NaN), 0)
  for (const sampleRate of [NaN, Infinity, 0, -32000]) {
    const invalid = new MusicAnalysis().update(
      waveform,
      spectrum,
      sampleRate,
      0,
      0.25,
    )
    assert.equal(invalid.low, 0)
    assert.equal(invalid.mid, 0)
    assert.equal(invalid.high, 0)
  }
})
