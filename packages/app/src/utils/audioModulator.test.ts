// Pins the modulation step the live overlay and the exports share: it eases a
// target in from the authored value, starts over on reset, and takes a preset
// change on the next step.
import { describe, expect, it } from 'vitest'
import { createAudioModulator } from './audioModulator'
import type { AudioMappingEntry, FrameData } from './audioMapping'

const loud: FrameData & { isBeat: boolean } = {
  bands: [0, 0, 0, 0, 0, 0, 0, 0],
  rms: 1,
  centroid: 0,
  flatness: 0,
  onsetStrength: 0,
  isBeat: false,
}

const rmsToExposure: AudioMappingEntry = {
  audioFeature: 'rms',
  target: { kind: 'renderSetting', param: 'exposure' },
  sensitivity: 1,
  range: [0, 4],
}

const authored = { renderSettings: { exposure: 0.2 } }

describe('createAudioModulator', () => {
  it('eases a target in from its authored value', () => {
    const modulator = createAudioModulator('standard')
    const { values } = modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    expect(values[0]!.value).toBeCloseTo(0.2 * Math.exp(0.02), 12)
  })

  it('starts over from the authored value after a reset', () => {
    const modulator = createAudioModulator('standard')
    for (let tick = 0; tick < 30; tick++) {
      modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    }
    modulator.reset()
    const { values } = modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    expect(values[0]!.value).toBeCloseTo(0.2 * Math.exp(0.02), 12)
  })

  it('passes the mapped value through with no authored flame', () => {
    const modulator = createAudioModulator('standard')
    expect(modulator.step(loud, [rmsToExposure], 1 / 30).values[0]!.value).toBe(
      4,
    )
  })

  it('applies a preset change on the next step', () => {
    const modulator = createAudioModulator('intense')
    modulator.setPreset('calm')
    const { values } = modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    expect(values[0]!.value).toBeCloseTo(0.2 * Math.exp(0.01), 12)
  })
})
