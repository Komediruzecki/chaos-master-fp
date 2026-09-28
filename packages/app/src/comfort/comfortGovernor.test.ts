// Pins the comfort governor: slew caps per target kind, the wrap-aware hue
// cap, the brightness and zoom windows, seeding from the authored value, and
// the behaviour on preset changes, stalls, steps of no time and non-finite
// input.
import { numberDomainOf, RenderSettings } from '@chaos-master/core'
import { describe, expect, it } from 'vitest'
import { createComfortGovernor, MAX_STEP_SECONDS, PROBABILITY_FLOOR, } from './comfortGovernor'
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
      // Exposure is an ln gain already: its own units are the window's.
      expect(
        worstSwing(out, Math.round(brightnessWindowSeconds * fps)),
      ).toBeLessThanOrEqual(brightnessWindowRange + 1e-9)
    }
  })

  it('climbs a far target at the window rate, not the slew rate', () => {
    // Intense slews 1.5 a second, but any 0.5 s may only span 0.35: 0.7 a
    // second.
    const governor = createComfortGovernor('intense')
    let out = 1
    for (let frame = 0; frame < 64; frame++) {
      out = governor.step(exposure, 'render.exposure', 8, 1 / 64, () => 1)
    }
    expect(out).toBeCloseTo(1.7, 10)
  })
})

type BrightnessKey =
  | 'exposure'
  | 'vibrancy'
  | 'contrast'
  | 'gamma'
  | 'highlightPower'
  | 'lightPower'
  | 'depthColorPower'

/**
 * Each brightness setting in the units the renderer shows it in, where equal
 * steps look equal: exposure is already the log of a gain (the colour pass
 * multiplies by 2 exp(exposure)), vibrancy scales chroma and rests at 0,
 * contrast scales the tone-mapped density and gamma is its exponent, so
 * those two act by ratio. The powers are linear blend weights.
 */
const RENDERED: Record<BrightnessKey, (value: number) => number> = {
  exposure: (value) => value,
  vibrancy: (value) => value,
  contrast: Math.log,
  gamma: Math.log,
  highlightPower: (value) => value,
  lightPower: (value) => value,
  depthColorPower: (value) => value,
}

/** The domain the flame schema gives a render setting. */
function schemaDomain(param: BrightnessKey): { min: number; max: number } {
  const domain = numberDomainOf(RenderSettings.entries[param])
  if (!domain) throw new Error(`${param} has no schema domain`)
  return domain
}

/** The widest swing between two outputs at most `seconds` apart. */
function worstSwingByTime(
  times: readonly number[],
  shown: readonly number[],
  seconds: number,
): number {
  let worst = 0
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      if (times[j]! - times[i]! > seconds + 1e-9) break
      worst = Math.max(worst, Math.abs(shown[i]! - shown[j]!))
    }
  }
  return worst
}

describe('the units the renderer shows', () => {
  it('moves a negative exposure one capped step on its first frame', () => {
    // example33 is authored at -4.583. A row asking for 1 moves it 0.6 per
    // second on Standard: 0.02 in the first 1/30 s.
    const governor = createComfortGovernor('standard')
    expect(
      governor.step(exposure, 'render.exposure', 1, 1 / 30, () => -4.583),
    ).toBeCloseTo(-4.563, 12)
  })

  it('settles on the negative exposure a row asks for', () => {
    const governor = createComfortGovernor('standard')
    let out = 0
    for (let frame = 0; frame < 30 * 30; frame++) {
      out = governor.step(exposure, 'render.exposure', -3, 1 / 30, () => 0.25)
    }
    expect(out).toBeCloseTo(-3, 12)
  })

  it('takes a ratio setting down to its schema minimum and straight back', () => {
    // Contrast acts by ratio, and the schema lets it fall to 0.01. A row
    // asking for 0 bottoms out there, and the climb back shows on the very
    // next frame instead of first crossing values the writer clamps away.
    const contrast: FlameTarget = { kind: 'renderSetting', param: 'contrast' }
    const governor = createComfortGovernor('standard')
    let bottom = Number.NaN
    for (let frame = 0; frame < 30 * 30; frame++) {
      bottom = governor.step(contrast, 'render.contrast', 0, 1 / 30, () => 1)
    }
    const back = governor.step(contrast, 'render.contrast', 1, 1 / 30)
    expect(bottom).toBeCloseTo(0.01, 12)
    expect(back).toBeCloseTo(0.01 * Math.exp(0.02), 12)
  })

  it('holds exposure 8 to the Standard window in exposure units', () => {
    // A 2 Hz square wave from 8 down to 4.
    const governor = createComfortGovernor('standard')
    const out: number[] = []
    for (let frame = 0; frame < 30 * 20; frame++) {
      const high = Math.floor(frame / 7.5) % 2 === 0
      out.push(
        governor.step(
          exposure,
          'render.exposure',
          high ? 8 : 4,
          1 / 30,
          () => 8,
        ),
      )
    }
    expect(worstSwing(out, 15)).toBeLessThanOrEqual(0.18 + 1e-9)
  })

  // Random targets and seeds across each setting's schema domain, at steady
  // and ragged frame rates with stalls: every pair of outputs at most 500 ms
  // apart differs by no more than the preset's window range, measured in the
  // units the renderer shows.
  it.each(
    COMFORT_PRESETS.flatMap((preset) =>
      (Object.keys(RENDERED) as BrightnessKey[]).map(
        (param) => [preset, param] as const,
      ),
    ),
  )('holds %s %s to the window range across its domain', (preset, param) => {
    const { min, max } = schemaDomain(param)
    const shownAs = RENDERED[param]
    const byRatio = shownAs === Math.log
    const { brightnessWindowRange, brightnessWindowSeconds } =
      COMFORT_CAPS[preset]
    const target: FlameTarget = { kind: 'renderSetting', param }
    const breaches: { run: number; swing: number }[] = []
    for (let run = 0; run < 12; run++) {
      const random = lcg(1000 * run + param.length * 31 + preset.length)
      const draw = () =>
        byRatio
          ? Math.exp(Math.log(min) + random() * (Math.log(max) - Math.log(min)))
          : min + random() * (max - min)
      const seed = draw()
      const fps = [24, 30, 60][run % 3]!
      const ragged = run >= 6
      const governor = createComfortGovernor(preset)
      const times: number[] = []
      const shown: number[] = []
      let asked = draw()
      let holdUntil = 0
      let t = 0
      for (let frame = 0; frame < fps * 10; frame++) {
        if (frame >= holdUntil) {
          asked = draw()
          holdUntil = frame + Math.floor(random() * fps)
        }
        // A ragged clock ticks every 4 to 54 ms and stalls now and then.
        const dt = !ragged
          ? 1 / fps
          : random() < 0.02
            ? 0.4
            : 0.004 + random() * 0.05
        const value = governor.step(target, param, asked, dt, () => seed)
        t += Math.min(dt, MAX_STEP_SECONDS)
        times.push(t)
        shown.push(shownAs(value))
      }
      const swing = worstSwingByTime(times, shown, brightnessWindowSeconds)
      if (swing > brightnessWindowRange + 1e-9) breaches.push({ run, swing })
    }
    expect(breaches).toEqual([])
  })
})

describe('the schema range', () => {
  // A row can ask past what the schema allows: sensitivity 2 on Pulse's bass
  // row asks vibrancy for 4.55, and the schema stops at 3. Governed out
  // there, the value the writer clamped did not move again until the
  // governor was back inside, seconds after the music dropped. Each setting
  // starts at its bound, is asked past it for two seconds, then back inside:
  // it holds at the bound and turns back on the very next frame, one
  // Standard step at 30 fps.
  const step = COMFORT_CAPS.standard.brightnessRate / 30
  const zoomStep = COMFORT_CAPS.standard.zoomLogRate / 30
  const paletteStep = COMFORT_CAPS.standard.paletteSpeedRate / 30
  it.each([
    ['exposure', 8, 20, 0, 8 - step],
    ['exposure', -8, -20, 0, -8 + step],
    ['vibrancy', 3, 10, 1, 3 - step],
    ['vibrancy', 0, -3, 1, step],
    ['highlightPower', 2, 5, 1, 2 - step],
    ['highlightPower', 0, -1, 1, step],
    ['lightPower', 5, 9, 1, 5 - step],
    ['depthColorPower', 5, 9, 1, 5 - step],
    ['contrast', 20, 100, 1, 20 * Math.exp(-step)],
    ['gamma', 8, 50, 1, 8 * Math.exp(-step)],
    ['zoom', 500, 5000, 1, 500 * Math.exp(-zoomStep)],
    ['paletteSpeed', 0, -2, 1, paletteStep],
  ] as const)(
    'holds %s at its schema bound %d and turns back the next frame',
    (param, bound, beyond, inside, back) => {
      const target: FlameTarget = { kind: 'renderSetting', param }
      const governor = createComfortGovernor('standard')
      let held = Number.NaN
      for (let frame = 0; frame < 60; frame++) {
        held = governor.step(target, param, beyond, 1 / 30, () => bound)
      }
      expect(held).toBeCloseTo(bound, 12)
      expect(governor.step(target, param, inside, 1 / 30)).toBeCloseTo(back, 12)
    },
  )

  it('starts an authored value past the schema from the bound', () => {
    const vibrancy: FlameTarget = { kind: 'renderSetting', param: 'vibrancy' }
    const governor = createComfortGovernor('standard')
    expect(
      governor.step(vibrancy, 'render.vibrancy', 1, 1 / 30, () => 3.5),
    ).toBeCloseTo(2.98, 12)
  })

  it('passes a first value with no authored one through held to the schema', () => {
    const governor = createComfortGovernor('standard')
    expect(governor.step(exposure, 'render.exposure', 12, 1 / 30)).toBe(8)
  })
})

describe('the zoom window', () => {
  // The old Drift row: mids mapped onto zoom [0.85, 1.22], on a flame
  // authored at 1.1. Breathing at 0.1-0.5 Hz is the zoom most likely to make
  // a viewer sick, and Calm allows no beat pulse at all.
  const rowZoom = (level: number) => 0.85 + level * (1.22 - 0.85)
  const inputs = {
    'a 0.3 Hz sinusoid': (t: number) =>
      0.5 + 0.5 * Math.sin(2 * Math.PI * 0.3 * t),
    'a 2 Hz square wave': (t: number) => (Math.floor(t * 4) % 2 === 0 ? 1 : 0),
  }
  const cases = COMFORT_PRESETS.flatMap((preset) =>
    (Object.keys(inputs) as (keyof typeof inputs)[]).flatMap((input) =>
      [30, 60].map((fps) => [preset, input, fps] as const),
    ),
  )

  it.each(cases)(
    'holds %s zoom under %s at %i fps to its range inside any 5 s',
    (preset, input, fps) => {
      const { zoomLogRate, zoomWindowRange, zoomWindowSeconds } =
        COMFORT_CAPS[preset]
      const governor = createComfortGovernor(preset)
      // The authored zoom is the first thing on screen.
      const ln = [Math.log(1.1)]
      for (let frame = 1; frame <= fps * 30; frame++) {
        const asked = rowZoom(inputs[input](frame / fps))
        ln.push(
          Math.log(
            governor.step(zoom, 'render.zoom', asked, 1 / fps, () => 1.1),
          ),
        )
      }
      const fastest = Math.max(
        ...ln.slice(1).map((y, i) => Math.abs(y - ln[i]!)),
      )
      expect(fastest).toBeLessThanOrEqual(zoomLogRate / fps + 1e-12)
      expect(
        worstSwing(ln, Math.round(zoomWindowSeconds * fps)),
      ).toBeLessThanOrEqual(zoomWindowRange + 1e-9)
    },
  )

  // As the brightness window's slow square wave, at the zoom window's scale:
  // each half period outlasts 5 s, and two minutes give the summed time room
  // to round an output exactly one window old to a hair older.
  it.each(PRESETS_BY_RATE)(
    'holds a slow square wave on zoom inside its range on %s at %i fps',
    (preset, fps) => {
      const { zoomWindowRange, zoomWindowSeconds } = COMFORT_CAPS[preset]
      const governor = createComfortGovernor(preset)
      const ln: number[] = []
      for (let frame = 0; frame < fps * 120; frame++) {
        const high = Math.floor(frame / (6 * fps)) % 2 === 0
        const asked = rowZoom(high ? 1 : 0)
        ln.push(
          Math.log(governor.step(zoom, 'render.zoom', asked, 1 / fps, () => 1)),
        )
      }
      expect(
        worstSwing(ln, Math.round(zoomWindowSeconds * fps)),
      ).toBeLessThanOrEqual(zoomWindowRange + 1e-9)
    },
  )

  it('holds zoom at its authored value in Calm', () => {
    const governor = createComfortGovernor('calm')
    const out: number[] = []
    for (let frame = 0; frame < 30 * 20; frame++) {
      const asked = rowZoom(inputs['a 2 Hz square wave'](frame / 30))
      out.push(governor.step(zoom, 'render.zoom', asked, 1 / 30, () => 1.1))
    }
    expect(Math.min(...out)).toBeCloseTo(1.1, 12)
    expect(Math.max(...out)).toBeCloseTo(1.1, 12)
  })
})

describe('slew caps', () => {
  it('moves zoom by at most its log rate', () => {
    // One frame at 30 fps: 0.35 / 30 e-folds, inside Standard's 0.02 window.
    const governor = createComfortGovernor('standard')
    expect(governor.step(zoom, 'render.zoom', 10, 1 / 30, () => 1)).toBeCloseTo(
      Math.exp(0.35 / 30),
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
    ).toBeCloseTo(1.02, 12)
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
      out = governor.step(affineA, 'tx.0.preAffine.a', 50, 1 / 30, () => 1)
    }
    governor.setPreset('calm')
    expect(governor.preset()).toBe('calm')
    const next = governor.step(affineA, 'tx.0.preAffine.a', 50, 1 / 30)
    expect(next - out).toBeCloseTo(COMFORT_CAPS.calm.affineLinearRate / 30, 12)
  })

  it('moves at most one capped step after a stall', () => {
    const governor = createComfortGovernor('standard')
    governor.step(affineA, 'tx.0.preAffine.a', 1, 1 / 30)
    const out = governor.step(affineA, 'tx.0.preAffine.a', 1000, 5)
    expect(out - 1).toBeCloseTo(
      COMFORT_CAPS.standard.affineLinearRate * MAX_STEP_SECONDS,
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

describe('edge cases', () => {
  // A step of no time moves nothing, so it must add nothing to a window that
  // forgets outputs by time: counted as outputs, a run of them grew the window
  // without bound and made every step slower than the last.
  it.each([
    ['zero', 0],
    ['negative', -0.2],
    ['NaN', Number.NaN],
  ])('holds a target through a long run of %s steps', (_, dt) => {
    const governor = createComfortGovernor('standard')
    const start = governor.step(
      exposure,
      'render.exposure',
      8,
      1 / 30,
      () => 0.25,
    )
    const began = globalThis.performance.now()
    let held = Number.NaN
    for (let tick = 0; tick < 150_000; tick++) {
      held = governor.step(exposure, 'render.exposure', 8, dt)
    }
    const elapsed = globalThis.performance.now() - began
    const next = governor.step(exposure, 'render.exposure', 8, 1 / 30)
    expect(start).toBeCloseTo(0.27, 12)
    expect(held).toBe(start)
    expect(next).toBeCloseTo(0.29, 12)
    // Tens of milliseconds when each step costs the same; tens of seconds
    // when each one walks every output before it.
    expect(elapsed).toBeLessThan(2000)
  })

  it.each([Number.NaN, Infinity, -Infinity])(
    'shows the authored value for a first value of %d, then eases in from it',
    (value) => {
      const governor = createComfortGovernor('standard')
      expect(
        governor.step(exposure, 'render.exposure', value, 1 / 30, () => 0.25),
      ).toBe(0.25)
      expect(
        governor.step(exposure, 'render.exposure', 8, 1 / 30, () => 0.25),
      ).toBeCloseTo(0.27, 12)
    },
  )

  it('takes a transform probability down to its floor and straight back', () => {
    const probability: FlameTarget = {
      kind: 'transformProperty',
      transformIdx: 0,
      property: 'probability',
    }
    const governor = createComfortGovernor('intense')
    let bottom = Number.NaN
    for (let frame = 0; frame < 30 * 20; frame++) {
      bottom = governor.step(
        probability,
        'tx.0.probability',
        0,
        1 / 30,
        () => 0.5,
      )
    }
    const back = governor.step(probability, 'tx.0.probability', 1, 1 / 30)
    expect(bottom).toBeCloseTo(PROBABILITY_FLOOR, 12)
    expect(back).toBeCloseTo(PROBABILITY_FLOOR * Math.exp(1.5 / 30), 12)
  })

  it('keeps the window through a switch to a wider preset', () => {
    // Standard climbs 0.18 from the authored 1 and holds; Intense then
    // allows 0.35 across the same 500 ms, the outputs before the switch
    // included.
    const governor = createComfortGovernor('standard')
    const times = [0]
    const shown = [1]
    for (let frame = 1; frame <= 60; frame++) {
      if (frame === 13) governor.setPreset('intense')
      shown.push(governor.step(exposure, 'render.exposure', 8, 1 / 30, () => 1))
      times.push(frame / 30)
    }
    expect(worstSwingByTime(times, shown, 0.5)).toBeCloseTo(0.35, 9)
  })

  it('holds a target after a switch to a narrower preset until its window allows a move', () => {
    // Intense climbs 0.35 from the authored 1 in seven frames. Standard
    // allows 0.18: the output holds at 1.35 until every output under 1.17
    // has left the window, eight frames later, then climbs at Standard's
    // 0.02 a frame.
    const governor = createComfortGovernor('intense')
    for (let frame = 1; frame <= 10; frame++) {
      governor.step(exposure, 'render.exposure', 8, 1 / 30, () => 1)
    }
    governor.setPreset('standard')
    const after: number[] = []
    for (let frame = 11; frame <= 60; frame++) {
      after.push(governor.step(exposure, 'render.exposure', 8, 1 / 30))
    }
    expect(after.slice(0, 8).map((value) => value.toFixed(12))).toEqual(
      Array.from({ length: 8 }, () => (1.35).toFixed(12)),
    )
    expect(after[8]).toBeCloseTo(1.37, 12)
    expect(worstSwing(after, 15)).toBeCloseTo(0.18, 9)
  })
})
