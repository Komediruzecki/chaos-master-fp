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
  close(result.energy, 0.3 * (1 - Math.exp(-1)))
  close(result.low, 0.3 * (1 - Math.exp(-1)))
  close(result.mid, 0.3 * (1 - Math.exp(-1)))
  close(result.high, 0.5 * (1 - Math.exp(-1)))
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
  close(frame.energy, 1 - Math.exp(-0.25 / 0.18))
  close(frame.high, 1 - Math.exp(-0.25 / 0.18))
  assert.equal(frame.low, 0)
  assert.equal(frame.mid, 0)
  close(smoothEnvelope(NaN, Infinity, NaN), 0)
})
