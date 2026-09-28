// Pins the modulation step the live overlay and the exports share: it eases a
// target in from the authored value, starts over on reset, and takes a preset
// change on the next step.
import { describe, expect, it } from 'vitest'
import { COMFORT_PRESETS } from '@/comfort/comfortPresets'
import { createAudioModulator } from './audioModulator'
import { applyAudioTargetValues } from './audioTargets'
import { RENDER_PRESETS } from './audioWiringPresets'
import type { AudioMappingEntry, AudioTargetValue, FlameTarget, FrameData, } from './audioMapping'

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

/**
 * What the overlay shows for `param` this frame: the value the modulator
 * wrote, or the authored one where it wrote none.
 */
function shown(
  values: readonly AudioTargetValue[],
  param: string,
  fallback: number,
): number {
  const written = values.filter(
    ({ target }) => target.kind === 'renderSetting' && target.param === param,
  )
  return written.at(-1)?.value ?? fallback
}

/** The widest swing between two outputs at most `span` frames apart. */
function worstSwing(series: readonly number[], span: number): number {
  let worst = 0
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j <= Math.min(series.length - 1, i + span); j++) {
      worst = Math.max(worst, Math.abs(series[i]! - series[j]!))
    }
  }
  return worst
}

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

  it.each(COMFORT_PRESETS)(
    "turns Pulse's bass row at sensitivity 2 back as soon as the bass drops, on %s",
    (preset) => {
      // The row asks vibrancy for up to 4.55 and the schema stops at 3.
      // Governed out there, the value shown held at 3 until the governor was
      // back under it: 4.2 s after the bass dropped on Standard. Now the
      // row's own 160 ms release is all that delays it: the mapped value
      // falls under 3 on the third quiet frame.
      const row: AudioMappingEntry = {
        ...RENDER_PRESETS.pulse[0]!,
        sensitivity: 2,
      }
      const flame = { renderSettings: { vibrancy: 1 } }
      const bass = (level: number) => ({
        ...loud,
        rms: 0,
        bands: [0, level, 0, 0, 0, 0, 0, 0],
      })
      const modulator = createAudioModulator(preset)
      const shownAt = (level: number) => {
        const { values } = modulator.step(bass(level), [row], 1 / 30, flame)
        const copy = structuredClone(flame)
        applyAudioTargetValues(copy, values)
        return {
          governed: values[0]!.value,
          shown: copy.renderSettings.vibrancy,
        }
      }
      let top = 0
      for (let frame = 0; frame < 30 * 25; frame++) {
        top = Math.max(top, shownAt(1).governed)
      }
      let frames = 1
      while (shownAt(0).shown >= 3 && frames < 30 * 30) frames++
      expect({ top, frames }).toEqual({ top: 3, frames: 3 })
    },
  )

  it('applies a preset change on the next step', () => {
    const modulator = createAudioModulator('intense')
    modulator.setPreset('calm')
    const { values } = modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    expect(values[0]!.value).toBeCloseTo(0.21, 12)
  })

  it('takes a negative step as no time, for the envelope as for the governor', () => {
    // A rise stepped by minus the attack time divided the envelope by zero
    // and left NaN in it, and the governor then held the target still for
    // good.
    const row: AudioMappingEntry = {
      ...rmsToExposure,
      attackMs: 40,
      releaseMs: 220,
    }
    const quiet = { ...loud, rms: 0 }
    const modulator = createAudioModulator('standard')
    const at = (frame: typeof loud, dt: number) =>
      modulator.step(frame, [row], dt, authored).values[0]!.value
    const first = at(quiet, 1 / 30)
    const held = at(loud, -0.04)
    const next = at(loud, 1 / 30)
    expect(first).toBeCloseTo(0.18, 12)
    expect(held).toBe(first)
    expect(next).toBeCloseTo(0.2, 12)
  })

  it('governs a departing target back to its authored value', () => {
    // Two seconds of rms 1 on a [0, 4] row climb exposure from 0.2 at
    // Standard's window rate, 0.18 per 500 ms, to 0.92. With the row gone,
    // exposure comes home the same way: four drops of 0.18, each nine frames
    // of 0.02 starting 15 frames apart, so it is home on frame 54. It stays
    // in the values until then and leaves them on arrival.
    const modulator = createAudioModulator('standard')
    const series = [0.2]
    for (let frame = 0; frame < 60; frame++) {
      const { values } = modulator.step(loud, [rmsToExposure], 1 / 30, authored)
      series.push(shown(values, 'exposure', 0.2))
    }
    const top = series.at(-1)!
    let frames = 0
    let values: AudioTargetValue[] = []
    do {
      values = modulator.step(loud, [], 1 / 30, authored).values
      series.push(shown(values, 'exposure', 0.2))
      frames++
    } while (values.length > 0 && frames < 30 * 30)
    expect(top).toBeCloseTo(0.92, 12)
    expect(frames).toBe(54)
    expect(worstSwing(series, 15)).toBeCloseTo(0.18, 9)
  })

  it('eases a target back in when its mapping returns', () => {
    // The row leaves for 300 ms and comes back: exposure turns round from
    // where it is on screen instead of cutting to the authored value and back.
    const modulator = createAudioModulator('standard')
    const series = [0.2]
    const wiring = (frame: number) =>
      frame < 60 || frame >= 69 ? [rmsToExposure] : []
    for (let frame = 0; frame < 120; frame++) {
      const { values } = modulator.step(loud, wiring(frame), 1 / 30, authored)
      series.push(shown(values, 'exposure', 0.2))
    }
    expect(worstSwing(series, 15)).toBeCloseTo(0.18, 9)
  })

  it('starts over from the authored value once a departed target is home', () => {
    const modulator = createAudioModulator('standard')
    for (let frame = 0; frame < 60; frame++) {
      modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    }
    for (let frame = 0; frame < 90; frame++) {
      modulator.step(loud, [], 1 / 30, authored)
    }
    const { values } = modulator.step(loud, [rmsToExposure], 1 / 30, authored)
    expect(shown(values, 'exposure', Number.NaN)).toBeCloseTo(0.22, 12)
  })

  it('drops a departing target whose transform is gone at once', () => {
    const a: FlameTarget = {
      kind: 'transformAffine',
      transformIdx: 0,
      transformId: 't0',
      matrix: 'preAffine',
      param: 'a',
    }
    const row: AudioMappingEntry = {
      audioFeature: 'rms',
      target: a,
      sensitivity: 1,
      range: [1, 2],
    }
    const flame = { transforms: { t0: { preAffine: { a: 1 } } } }
    const modulator = createAudioModulator('standard')
    for (let frame = 0; frame < 30; frame++) {
      modulator.step(loud, [row], 1 / 30, flame)
    }
    const gone = modulator.step(loud, [], 1 / 30, { transforms: {} })
    const back = modulator.step(loud, [], 1 / 30, flame)
    expect(gone.values).toEqual([])
    expect(back.values).toEqual([])
  })

  it('switches Bloom to Drift and back inside 300 ms without a flash', () => {
    // Standard, the schema's default exposure 0.25, every feature steady at
    // 0.8: Bloom holds exposure at 1.64. Drift wires no exposure, so for
    // 300 ms exposure heads home, and Bloom turns it round from there.
    const steady: FrameData & { isBeat: boolean } = {
      bands: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
      rms: 0.8,
      centroid: 0.8 * 20000,
      flatness: 0.8,
      onsetStrength: 0.8,
      isBeat: false,
    }
    const flame = {
      renderSettings: {
        exposure: 0.25,
        vibrancy: 1,
        contrast: 1,
        palettePhase: 0,
        paletteSpeed: 1,
        camera: { zoom: 1 },
      },
    }
    const modulator = createAudioModulator('standard')
    const series = [0.25]
    for (let frame = 1; frame <= 30 * 11; frame++) {
      const wiring =
        frame > 300 && frame <= 309
          ? RENDER_PRESETS.drift
          : RENDER_PRESETS.bloom
      const { values } = modulator.step(steady, wiring, 1 / 30, flame)
      series.push(shown(values, 'exposure', 0.25))
    }
    expect(series[300]).toBeCloseTo(1.64, 12)
    expect(worstSwing(series, 15)).toBeCloseTo(0.18, 9)
  })
})
