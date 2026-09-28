// Pins the comfort governor: slew caps per target kind, the wrap-aware hue
// cap, the brightness window, seeding from the authored value, and the
// behaviour on preset changes, stalls and non-finite input.
import { describe, expect, it } from 'vitest'
import { createComfortGovernor, MAX_STEP_SECONDS } from './comfortGovernor'
import { COMFORT_CAPS, COMFORT_PRESETS } from './comfortPresets'
import type { FlameTarget } from '@/utils/audioMapping'

const exposure: FlameTarget = { kind: 'renderSetting', param: 'exposure' }
const highlight: FlameTarget = {
  kind: 'renderSetting',
  param: 'highlightPower',
}
const zoom: FlameTarget = { kind: 'renderSetting', param: 'zoom' }
const phase: FlameTarget = { kind: 'renderSetting', param: 'palettePhase' }
const skipIters: FlameTarget = { kind: 'renderSetting', param: 'skipIters' }
const affineA: FlameTarget = {
  kind: 'transformAffine',
  transformIdx: 0,
  matrix: 'preAffine',
  param: 'a',
}

/** Deterministic uniform [0, 1) sequence, so a failure replays exactly. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** The widest swing between two outputs at most `span` frames apart. */
function worstSwing(out: readonly number[], span: number): number {
  let worst = 0
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j <= Math.min(out.length - 1, i + span); j++) {
      worst = Math.max(worst, Math.abs(out[i]! - out[j]!))
    }
  }
  return worst
}

const PRESETS_BY_RATE = COMFORT_PRESETS.flatMap((preset) =>
  [24, 30, 32, 60, 64].map((fps) => [preset, fps] as const),
)

describe('the brightness window', () => {
  // At these rates 500 ms is a whole number of frames, so an output sits
  // exactly one window before another. Each half period of the square wave
  // outlasts the window, so the window, not the wave, sets the swing. Time is
  // summed step by step, and at 60 fps the rounding first costs this wave a
  // step after more than eight seconds: hence twenty.
  it.each(PRESETS_BY_RATE)(
    'holds a slow square wave inside the window range on %s at %i fps',
    (preset, fps) => {
      const governor = createComfortGovernor(preset)
      const { brightnessWindowRange, brightnessWindowSeconds } =
        COMFORT_CAPS[preset]
      const out: number[] = []
      for (let frame = 0; frame < fps * 20; frame++) {
        const high = Math.floor(frame / (0.8 * fps)) % 2 === 0
        out.push(
          governor.step(
            highlight,
            'render.highlightPower',
            high ? 1.8 : 0.2,
            1 / fps,
            () => 1,
          ),
        )
      }
      expect(
        worstSwing(out, Math.round(brightnessWindowSeconds * fps)),
      ).toBeLessThanOrEqual(brightnessWindowRange + 1e-9)
    },
  )

  it('holds a 12 Hz square wave on exposure inside the window range', () => {
    const fps = 60
    for (const preset of COMFORT_PRESETS) {
      const governor = createComfortGovernor(preset)
      const { brightnessWindowRange, brightnessWindowSeconds } =
        COMFORT_CAPS[preset]
      const out: number[] = []
      for (let frame = 0; frame < fps * 10; frame++) {
        const high = Math.floor((frame / fps) * 24) % 2 === 0
        out.push(
          governor.step(
            exposure,
            'render.exposure',
            high ? 4 : 0.25,
            1 / fps,
            () => 1,
          ),
        )
      }
      const span = Math.round(brightnessWindowSeconds * fps)
      let worst = 0
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j <= Math.min(out.length - 1, i + span); j++) {
          worst = Math.max(
            worst,
            Math.abs(Math.log(out[i]!) - Math.log(out[j]!)),
          )
        }
      }
      expect(worst).toBeLessThanOrEqual(brightnessWindowRange + 1e-9)
    }
  })

  it('climbs a far target at the window rate, not the slew rate', () => {
    // Intense slews 1.5 ln/s, but any 0.5 s may only span 0.35: 0.7 ln/s.
    const governor = createComfortGovernor('intense')
    let out = 1
    for (let frame = 0; frame < 64; frame++) {
      out = governor.step(exposure, 'render.exposure', 100, 1 / 64, () => 1)
    }
    expect(out).toBeCloseTo(Math.exp(0.7), 10)
  })
})

describe('slew caps', () => {
  it('moves zoom by at most its log rate', () => {
    const governor = createComfortGovernor('standard')
    expect(governor.step(zoom, 'render.zoom', 10, 0.1, () => 1)).toBeCloseTo(
      Math.exp(0.035),
      12,
    )
  })

  it('turns palettePhase forward across the wrap when that is shorter', () => {
    const governor = createComfortGovernor('standard')
    expect(
      governor.step(phase, 'render.palettePhase', 0.1, 0.1, () => 0.9),
    ).toBeCloseTo(0.9125, 12)
  })

  it('never turns palettePhase faster than the hue cap', () => {
    for (const preset of COMFORT_PRESETS) {
      const governor = createComfortGovernor(preset)
      const random = lcg(42)
      const dt = 1 / 30
      const cap = COMFORT_CAPS[preset].paletteTurnsPerSecond * dt
      let previous = governor.step(
        phase,
        'render.palettePhase',
        random(),
        dt,
        () => 0,
      )
      for (let frame = 0; frame < 600; frame++) {
        const next = governor.step(
          phase,
          'render.palettePhase',
          random() * 3,
          dt,
        )
        const turned = Math.abs(((next - previous + 1.5) % 1) - 0.5)
        expect(turned).toBeLessThanOrEqual(cap + 1e-12)
        expect(next).toBeGreaterThanOrEqual(0)
        expect(next).toBeLessThan(1)
        previous = next
      }
    }
  })

  it('moves an affine coefficient by at most its angular rate', () => {
    const governor = createComfortGovernor('calm')
    const step = COMFORT_CAPS.calm.affineLinearRate / 30
    expect(
      governor.step(affineA, 'tx.0.preAffine.a', 2, 1 / 30, () => 1),
    ).toBeCloseTo(1 + step, 12)
  })

  it('leaves skipIters free', () => {
    const governor = createComfortGovernor('calm')
    expect(
      governor.step(skipIters, 'render.skipIters', 40, 1 / 30, () => 20),
    ).toBe(40)
  })
})

describe('state', () => {
  it('starts from the authored value when one is given', () => {
    const governor = createComfortGovernor('standard')
    expect(
      governor.step(exposure, 'render.exposure', 3, 1 / 30, () => 1),
    ).toBeCloseTo(1.020201, 6)
  })

  it('passes the first value through when there is no authored value', () => {
    const governor = createComfortGovernor('calm')
    expect(governor.step(exposure, 'render.exposure', 3, 1 / 30)).toBe(3)
    expect(
      governor.step(exposure, 'render.exposure', 3, 1 / 30, () => 1),
    ).toBeCloseTo(3, 12)
  })

  it('switches preset without a jump', () => {
    const governor = createComfortGovernor('intense')
    let out = 0
    for (let frame = 0; frame < 30; frame++) {
      out = governor.step(zoom, 'render.zoom', 50, 1 / 30, () => 1)
    }
    governor.setPreset('calm')
    expect(governor.preset()).toBe('calm')
    const next = governor.step(zoom, 'render.zoom', 50, 1 / 30)
    expect(Math.log(next) - Math.log(out)).toBeCloseTo(
      COMFORT_CAPS.calm.zoomLogRate / 30,
      12,
    )
  })

  it('moves at most one capped step after a stall', () => {
    const governor = createComfortGovernor('standard')
    governor.step(zoom, 'render.zoom', 1, 1 / 30)
    const out = governor.step(zoom, 'render.zoom', 1000, 5)
    expect(Math.log(out)).toBeCloseTo(
      COMFORT_CAPS.standard.zoomLogRate * MAX_STEP_SECONDS,
      12,
    )
  })

  it('holds the last output on a non-finite value', () => {
    const governor = createComfortGovernor('standard')
    const held = governor.step(zoom, 'render.zoom', 2, 1 / 30, () => 1)
    expect(governor.step(zoom, 'render.zoom', Number.NaN, 1 / 30)).toBe(held)
  })

  it('forgets every target on reset', () => {
    const governor = createComfortGovernor('calm')
    governor.step(zoom, 'render.zoom', 1, 1 / 30)
    governor.reset()
    expect(governor.step(zoom, 'render.zoom', 8, 1 / 30)).toBe(8)
  })
})
