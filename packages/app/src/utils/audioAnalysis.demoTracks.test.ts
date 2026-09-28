// The two demo tracks the app ships (public/audio) through the file analyzer:
// read from disk here, so this test is on the always-on list.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAudioAnalyzer } from './audioAnalysis'
import { audioBuffer, framesWhere } from './audioAnalysis.testUtils'

/** A 16-bit PCM WAV file mixed down to mono, with its sample rate. */
function readWav(name: string): {
  samples: Float32Array<ArrayBuffer>
  sampleRate: number
} {
  const path = join(import.meta.dirname, '../../public/audio', name)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a demo track the test table names, in this repo
  const bytes = readFileSync(path)
  let channels = 1
  let sampleRate = 0
  let data = bytes.subarray(0, 0)
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = bytes.toString('ascii', at, at + 4)
    const size = bytes.readUInt32LE(at + 4)
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(at + 10)
      sampleRate = bytes.readUInt32LE(at + 12)
    }
    if (id === 'data') data = bytes.subarray(at + 8, at + 8 + size)
    at += 8 + size + (size % 2)
  }
  const samples = new Float32Array(data.length / 2 / channels)
  for (let i = 0; i < samples.length; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      sum += data.readInt16LE((i * channels + c) * 2) / 32768
    }
    samples[i] = sum / channels
  }
  return { samples, sampleRate }
}

describe('the demo tracks', () => {
  it.each([
    ['cyber-pulse.wav', 20],
    ['ember-drift.wav', 20],
  ])('%s has %i onsets at 30 fps', async (name, onsets) => {
    const { samples, sampleRate } = readWav(name)
    const analyzer = await createAudioAnalyzer(
      audioBuffer(samples, sampleRate),
      30,
    )
    expect(
      framesWhere(analyzer, (frame) => frame.onsetStrength > 0),
    ).toHaveLength(onsets)
  })
})
