import { describe, expect, it } from 'vitest'
import { MAX_SKIP_ITERS_VALUE } from '@/flame/schema/flameSchema'
import { flameTargetKey, flameTargetPath } from './audioAnalysis'
import { buildFlamePreset, buildPreset, defaultAudioMapping, FLAME_PRESET_IDS, randomizeMappings, RENDER_PRESET_IDS, RENDER_PRESETS, } from './audioWiringPresets'
import type { TransformInfo } from './audioAnalysis'

function transforms(count: number, variationsEach = 2): TransformInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i}`,
    index: i,
    label: `Transform ${i + 1}`,
    variations: Array.from({ length: variationsEach }, (_, v) => ({
      id: `v${i}_${v}`,
      type: v === 0 ? 'linearVar' : 'swirlVar',
    })),
  }))
}

/** Deterministic stand-in for Math.random, so a "random" wiring is testable. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('flame-aware presets', () => {
  it('produce nothing when the flame has no transforms', () => {
    for (const id of FLAME_PRESET_IDS) {
      expect(buildFlamePreset(id, [])).toEqual([])
    }
  })

  it('are deterministic — the same flame always wires the same way', () => {
    const tf = transforms(3)
    for (const id of FLAME_PRESET_IDS) {
      expect(buildFlamePreset(id, tf)).toEqual(buildFlamePreset(id, tf))
    }
  })

  it('actually reach into the flame rather than only render settings', () => {
    const tf = transforms(3)
    for (const id of FLAME_PRESET_IDS) {
      const built = buildFlamePreset(id, tf)
      expect(built.length).toBeGreaterThan(0)
      expect(built.some((m) => m.target.kind !== 'renderSetting')).toBe(true)
    }
  })

  it('never wire a transform that does not exist', () => {
    const tf = transforms(2)
    for (const id of FLAME_PRESET_IDS) {
      for (const m of buildFlamePreset(id, tf)) {
        if ('transformIdx' in m.target) {
          expect(m.target.transformIdx).toBeLessThan(tf.length)
          expect(m.target.transformIdx).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('only name variation types the transform actually has', () => {
    const tf = transforms(2)
    const known = new Set(tf.flatMap((t) => t.variations.map((v) => v.type)))
    for (const m of buildFlamePreset('morph', tf)) {
      if (m.target.kind === 'variationWeight') {
        expect(known.has(m.target.variationType)).toBe(true)
      }
    }
  })

  it('morph yields nothing when no transform has a variation', () => {
    expect(buildFlamePreset('morph', transforms(3, 0))).toEqual([])
  })

  /*
   * A transform whose probability reaches 0 stops contributing points and the
   * branch disappears — a preset must never be able to delete part of the
   * flame it is supposed to be animating.
   */
  it('keeps probability ranges strictly above zero', () => {
    for (const id of FLAME_PRESET_IDS) {
      for (const m of buildFlamePreset(id, transforms(4))) {
        if (
          m.target.kind === 'transformProperty' &&
          m.target.property === 'probability'
        ) {
          expect(m.range[0]).toBeGreaterThan(0)
        }
      }
    }
  })

  it('never duplicates a target within one preset', () => {
    const tf = transforms(4)
    for (const id of FLAME_PRESET_IDS) {
      const keys = buildFlamePreset(id, tf).map((m) => flameTargetKey(m.target))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

describe('buildPreset', () => {
  it('falls back to a working preset when the flame cannot satisfy one', () => {
    // Silently wiring nothing would look like the preset was broken.
    const built = buildPreset('morph', [])
    expect(built.length).toBeGreaterThan(0)
  })

  it('returns copies, so editing a preset cannot mutate the table', () => {
    const a = buildPreset(RENDER_PRESET_IDS[0]!, [])
    const b = buildPreset(RENDER_PRESET_IDS[0]!, [])
    a[0]!.sensitivity = 99
    expect(b[0]!.sensitivity).not.toBe(99)
  })
})

describe('randomizeMappings', () => {
  it('always wires something, even for a flame with no transforms', () => {
    expect(randomizeMappings([], seeded(1)).length).toBeGreaterThan(0)
  })

  it('is reproducible for a given source of randomness', () => {
    const tf = transforms(3)
    expect(randomizeMappings(tf, seeded(42))).toEqual(
      randomizeMappings(tf, seeded(42)),
    )
  })

  it('varies between seeds', () => {
    const tf = transforms(4)
    const a = JSON.stringify(randomizeMappings(tf, seeded(1)))
    const b = JSON.stringify(randomizeMappings(tf, seeded(999)))
    expect(a).not.toBe(b)
  })

  it('only references transforms and variations that exist', () => {
    const tf = transforms(3)
    const known = new Set(tf.flatMap((t) => t.variations.map((v) => v.type)))
    for (let seed = 0; seed < 40; seed++) {
      for (const m of randomizeMappings(tf, seeded(seed))) {
        if ('transformIdx' in m.target) {
          expect(m.target.transformIdx).toBeLessThan(tf.length)
        }
        if (m.target.kind === 'variationWeight') {
          expect(known.has(m.target.variationType)).toBe(true)
        }
      }
    }
  })

  it('keeps probability ranges above zero across many rolls', () => {
    const tf = transforms(4)
    for (let seed = 0; seed < 40; seed++) {
      for (const m of randomizeMappings(tf, seeded(seed))) {
        if (
          m.target.kind === 'transformProperty' &&
          m.target.property === 'probability'
        ) {
          expect(m.range[0]).toBeGreaterThan(0)
        }
      }
    }
  })
})

/*
 * Audio modulation writes into the LIVE descriptor, so a preset range that
 * exceeds a schema bound does not merely look wrong — it leaves the flame
 * permanently invalid, and validateFlame then throws for breeding, export and
 * the ancestry tree alike. This happened: palettePhase is 0-1, a preset drove
 * it to 1.589 assuming radians, and that flame could not be bred again.
 */
describe('preset ranges stay inside the flame schema', () => {
  const BOUNDS: Record<string, [number, number]> = {
    vibrancy: [0, 3],
    exposure: [-8, 8],
    palettePhase: [0, 1],
    contrast: [0.01, 20],
    gamma: [0.1, 8],
    highlightPower: [0, 2],
    lightPower: [0, 5],
    depthColorPower: [0, 5],
    zoom: [0.01, 500],
    skipIters: [0, MAX_SKIP_ITERS_VALUE],
  }

  const everyPreset = () => [
    ...RENDER_PRESET_IDS.map((id) => [id, buildPreset(id, [])] as const),
    ...FLAME_PRESET_IDS.map(
      (id) => [id, buildFlamePreset(id, transforms(4))] as const,
    ),
  ]

  for (const [id, mappings] of everyPreset()) {
    it(`'${id}' never drives a render setting out of range`, () => {
      for (const m of mappings) {
        if (m.target.kind !== 'renderSetting') continue
        const bound = BOUNDS[m.target.param]
        if (!bound) continue
        expect(m.range[0]).toBeGreaterThanOrEqual(bound[0])
        expect(m.range[1]).toBeLessThanOrEqual(bound[1])
      }
    })
  }

  it('randomized wirings stay in range across many rolls', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const m of randomizeMappings(transforms(4), seeded(seed))) {
        if (m.target.kind !== 'renderSetting') continue
        const bound = BOUNDS[m.target.param]
        if (!bound) continue
        expect(m.range[0]).toBeGreaterThanOrEqual(bound[0])
        expect(m.range[1]).toBeLessThanOrEqual(bound[1])
      }
    }
  })
})

// zoom is an absolute value, not a relative one: a row driving it walks the
// render toward the row's own range regardless of what the flame was
// authored at, and snaps back the moment audio stops. Drift used to carry
// exactly this row ([1, 1.02]) — a flame authored at 0.36 crept to 0.74 over
// 180 s of steady audio. No built-in or randomized preset should drive it.
describe('zoom targets', () => {
  it('no preset drives the absolute zoom render setting', () => {
    const rows = [
      ...RENDER_PRESET_IDS.flatMap((id) => buildPreset(id, [])),
      ...FLAME_PRESET_IDS.flatMap((id) => buildFlamePreset(id, transforms(4))),
      ...Array.from({ length: 60 }, (_, seed) =>
        randomizeMappings(transforms(4), seeded(seed)),
      ).flat(),
    ].filter(
      (m) => m.target.kind === 'renderSetting' && m.target.param === 'zoom',
    )
    expect(rows).toEqual([])
  })
})

// x' = a x + b y + c, y' = d x + e y + f: `a` and `e` are the diagonal, so a
// scale drives those two. `d` is a shear term.
describe('the scale presets drive the affine diagonal', () => {
  it('swarm scales each transform through a and e', () => {
    const affine = buildFlamePreset('swarm', transforms(2))
      .filter((m) => m.target.kind === 'transformAffine')
      .map((m) => flameTargetPath(m.target))
    expect(affine).toEqual([
      'tx.0.preAffine.a',
      'tx.0.preAffine.e',
      'tx.1.preAffine.a',
      'tx.1.preAffine.e',
    ])
  })

  it('randomize only ever scales through a and e', () => {
    const params = new Set<string>()
    for (let seed = 1; seed <= 300; seed++) {
      for (const m of randomizeMappings(transforms(4), seeded(seed))) {
        if (m.target.kind === 'transformAffine') params.add(m.target.param)
      }
    }
    expect([...params].sort()).toEqual(['a', 'e'])
  })
})

describe('presets name what they wire by id', () => {
  it('every transform target carries its transform id, and a weight its variation id', () => {
    const tf = transforms(3)
    const built = [
      ...FLAME_PRESET_IDS.flatMap((id) => buildFlamePreset(id, tf)),
      ...randomizeMappings(tf, seeded(7)),
    ]
    for (const { target } of built) {
      if (!('transformIdx' in target)) continue
      expect(target.transformId).toBe(tf[target.transformIdx]!.id)
      if (target.kind === 'variationWeight') {
        const variation = tf[target.transformIdx]!.variations.find(
          (candidate) => candidate.id === target.variationId,
        )
        expect(variation?.type).toBe(target.variationType)
      }
    }
  })
})

// The shader wraps palettePhase at 1, so the old [0, 3.14] default swept the
// palette about three turns forward and back on every kick.
describe('the default wiring', () => {
  it('nudges the palette on a beat instead of cycling it', () => {
    const beat = RENDER_PRESETS.pulse.find(
      (m) =>
        m.audioFeature === 'beat' &&
        m.target.kind === 'renderSetting' &&
        m.target.param === 'palettePhase',
    )
    expect(beat).toMatchObject({
      range: [0, 0.12],
      attackMs: 60,
      releaseMs: 900,
    })
  })

  it('wires colour and the palette, and leaves brightness as authored', () => {
    expect(
      RENDER_PRESETS.pulse.map((m) => [
        m.audioFeature,
        flameTargetPath(m.target),
        m.range,
      ]),
    ).toEqual([
      ['bass', 'render.vibrancy', [0.25, 2.4]],
      ['beat', 'render.palettePhase', [0, 0.12]],
    ])
  })

  it('is the pulse preset, as a copy the caller may edit', () => {
    const mapping = defaultAudioMapping()
    expect(mapping).toEqual({ preset: 'pulse', mappings: RENDER_PRESETS.pulse })
    mapping.mappings[0]!.sensitivity = 5
    expect(RENDER_PRESETS.pulse[0]!.sensitivity).toBe(1)
  })
})
