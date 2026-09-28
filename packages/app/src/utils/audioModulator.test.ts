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
    expect(values[0]!.value).toBeCloseTo(0.22, 12)
  })

  it('starts over from the authored value after a reset', () => {
    const modulator = createAudioModulator('standard')
    for (let tick = 0; tick < 30; tick++) {
      modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    }
    modulator.reset()
    const { values } = modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    expect(values[0]!.value).toBeCloseTo(0.22, 12)
  })

  it('passes the mapped value through with no authored flame', () => {
    const modulator = createAudioModulator('standard')
    expect(modulator.step(loud, [rmsToExposure], 1 / 30).values[0]!.value).toBe(
      4,
    )
  })

  it('brings a [0, 1] vibrancy row back from silence at the window rate', () => {
    // Standard lets vibrancy climb 0.6 a second and span 0.18 inside any
    // 500 ms: 0 to 0.5 takes 37 frames at 30 fps, 1.23 s. Governed by
    // ratio, the row sat at a floor near 0 and took 16.7 s.
    const modulator = createAudioModulator('standard')
    const row: AudioMappingEntry = {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 1,
      range: [0, 1],
    }
    const flame = { renderSettings: { vibrancy: 0.5 } }
    const bass = (level: number) => ({
      ...loud,
      rms: 0,
      bands: [0, level, 0, 0, 0, 0, 0, 0],
    })
    let vibrancy = Number.NaN
    for (let frame = 0; frame < 25 * 30; frame++) {
      vibrancy = modulator.step(bass(0), [row], 1 / 30, flame).values[0]!.value
    }
    const silent = vibrancy
    let frames = 0
    while (vibrancy < 0.5 && frames < 30 * 30) {
      vibrancy = modulator.step(bass(1), [row], 1 / 30, flame).values[0]!.value
      frames++
    }
    expect({ silent, frames }).toEqual({ silent: 0, frames: 37 })
  })

  it('applies a preset change on the next step', () => {
    const modulator = createAudioModulator('intense')
    modulator.setPreset('calm')
    const { values } = modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    expect(values[0]!.value).toBeCloseTo(0.21, 12)
  })
})
