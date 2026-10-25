/** Independent nonlinear fixtures, colour recurrence, and fixed-component sampling. */
import { describe, expect, it } from 'vitest'
import { IDENTITY_AFFINE } from '../clash/placement'
import { validateFlame } from '../schema/flameSchema'
import { evaluateFlameFigurineTransform, flameFigurineLinearColour, sampleFlameFigurineCloud, } from './flameFigurineCloud'
import { buildPawnFlame } from './pawnFlame'

function oneMap(overrides: Record<string, unknown> = {}) {
  return validateFlame({
    ...buildPawnFlame(),
    transforms: {
      sample: {
        probability: 1,
        visible: true,
        color: { x: 0, y: 0 },
        colorSpeed: 1,
        preAffine: { ...IDENTITY_AFFINE },
        postAffine: { ...IDENTITY_AFFINE },
        variations: { linear: { type: 'linear3D', weight: 1, visible: true } },
        ...overrides,
      },
    },
  })
}

function map(overrides: Record<string, unknown> = {}) {
  return Object.values(oneMap(overrides).transforms)[0]!
}

describe('nonlinear flame figurine map evaluation', () => {
  it('evaluates native sinusoidal3D independently on all three axes', () => {
    const transform = map({
      variations: { sine: { type: 'sinusoidal3D', weight: 1 } },
    })
    const result = evaluateFlameFigurineTransform(transform, [
      0,
      Math.PI / 2,
      -Math.PI / 2,
    ])
    expect(result.position).toEqual([0, 1, -1])
  })

  it('includes z in native swirl3D radius while preserving z', () => {
    const transform = map({
      variations: { swirl: { type: 'swirl3D', weight: 1 } },
    })
    const { position } = evaluateFlameFigurineTransform(transform, [1, 0, 1])
    expect(position[0]).toBeCloseTo(Math.cos(2), 6)
    expect(position[1]).toBeCloseTo(Math.sin(2), 6)
    expect(position[2]).toBe(1)
  })

  it('uses the native 3D curl denominator EPS and finite singular-centre policy', () => {
    const transform = map({
      variations: { curl: { type: 'curl3D', weight: 1 } },
    })
    const { position } = evaluateFlameFigurineTransform(transform, [0, 1, 0])
    expect(position[0]).toBe(0)
    expect(position[1]).toBeCloseTo(2 / (2 + 0.000001), 6)
    expect(position[2]).toBe(0)
    expect(
      evaluateFlameFigurineTransform(transform, [-1, 0, 0]).position,
    ).toEqual([0, 0, 0])
  })

  it('applies a common pre-affine, external weighted sum, then post-affine once', () => {
    const transform = map({
      preAffine: { ...IDENTITY_AFFINE, d: 1 },
      postAffine: { ...IDENTITY_AFFINE, a: 3, d: 2 },
      color: { x: -0.1, y: 0.2 },
      colorSpeed: 0.25,
      variations: {
        linear: { type: 'linear3D', weight: 0.5 },
        sine: { type: 'sinusoidal3D', weight: 0.5 },
      },
    })
    const result = evaluateFlameFigurineTransform(
      transform,
      [0, 0, 0],
      [0.2, 0.4],
    )
    expect(result.position[0]).toBeCloseTo(2 + 1.5 * (1 + Math.sin(1)), 6)
    expect(result.position.slice(1)).toEqual([0, 0])
    expect(result.colour[0]).toBeCloseTo(0.125, 12)
    expect(result.colour[1]).toBeCloseTo(0.35, 12)
    const unnormalised = map({
      variations: { linear: { type: 'linear3D', weight: 2 } },
    })
    expect(
      evaluateFlameFigurineTransform(unnormalised, [1, 2, 3]).position,
    ).toEqual([2, 4, 6])
  })

  it('retains native colour recurrence rather than replacing it with the newest hue', () => {
    const transform = map({ color: { x: 0.2, y: -0.1 }, colorSpeed: 0.5 })
    const first = evaluateFlameFigurineTransform(transform, [0, 0, 0])
    const second = evaluateFlameFigurineTransform(
      transform,
      first.position,
      first.colour,
    )
    expect(first.colour).toEqual([0.1, -0.05])
    expect(second.colour[0]).toBeCloseTo(0.15, 12)
    expect(second.colour[1]).toBeCloseTo(-0.075, 12)
  })

  it('exports neutral L cubed in linear RGB and clips gamut with opaque alpha', () => {
    expect(flameFigurineLinearColour([0, 0], 0.75)).toEqual([
      0.421875, 0.421875, 0.421875, 1,
    ])
    const saturated = flameFigurineLinearColour([1, -1], 0.78, 1.25)
    expect(saturated.every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(saturated[3]).toBe(1)
    expect(flameFigurineLinearColour([0.1, -0.1], 0.78, 0)).toEqual(
      flameFigurineLinearColour([0, 0], 0.78),
    )
  })
})

describe('sampleFlameFigurineCloud', () => {
  it('keeps separate chains and native component hues with authored mixture masses', () => {
    const template = map()
    const flame = validateFlame({
      ...oneMap(),
      transforms: {
        left: {
          ...template,
          walkGroup: 'left',
          probability: 1,
          color: { x: -0.1, y: 0.12 },
          postAffine: { ...IDENTITY_AFFINE, a: 0, f: 0, k: 0, d: -1 },
        },
        right: {
          ...template,
          walkGroup: 'right',
          probability: 3,
          color: { x: 0.15, y: -0.08 },
          postAffine: { ...IDENTITY_AFFINE, a: 0, f: 0, k: 0, d: 1, h: 1 },
        },
      },
    })
    const cloud = sampleFlameFigurineCloud(flame, { count: 8, seed: 7 })
    expect(cloud.components).toEqual(['left', 'right'])
    expect(Array.from(cloud.componentIds)).toEqual([0, 0, 1, 1, 1, 1, 1, 1])
    for (let n = 0; n < 8; n++) {
      expect(Array.from(cloud.points.slice(n * 4, n * 4 + 4))).toEqual(
        n < 2 ? [-1, 0, 0, 1] : [1, 1, 0, 1],
      )
      const colour = n < 2 ? ([-0.1, 0.12] as const) : ([0.15, -0.08] as const)
      expect(Array.from(cloud.colors.slice(n * 4, n * 4 + 4))).toEqual(
        Array.from(
          new Float32Array(
            flameFigurineLinearColour(
              colour,
              0.78,
              flame.renderSettings.vibrancy,
            ),
          ),
        ),
      )
    }
  })

  it('settles a recurrence before applying the plot-only final affine', () => {
    const flame = oneMap({
      postAffine: { ...IDENTITY_AFFINE, a: 0.5, f: 0, k: 0, d: 1 },
    })
    flame.finalTransform = { ...IDENTITY_AFFINE, a: 2, d: 5 }
    expect(
      Array.from(
        sampleFlameFigurineCloud(flame, { count: 2, burnIn: 64 }).points,
      ),
    ).toEqual([9, 0, 0, 1, 9, 0, 0, 1])
  })

  it('is deterministic without changing the descriptor and rejects unsupported active maps', () => {
    const flame = oneMap({
      preAffine: { ...IDENTITY_AFFINE, a: 0.8, f: 0.8, k: 0.8 },
      variations: { sine: { type: 'sinusoidal3D', weight: 1 } },
    })
    const before = JSON.stringify(flame)
    const first = sampleFlameFigurineCloud(flame, {
      count: 256,
      seed: 11,
      burnIn: 0,
    })
    expect(first).toEqual(
      sampleFlameFigurineCloud(flame, { count: 256, seed: 11, burnIn: 0 }),
    )
    expect(first.points).not.toEqual(
      sampleFlameFigurineCloud(flame, { count: 256, seed: 12, burnIn: 0 })
        .points,
    )
    expect(first.points.every(Number.isFinite)).toBe(true)
    expect(
      first.colors.every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ),
    ).toBe(true)
    expect(JSON.stringify(flame)).toBe(before)
    expect(() =>
      sampleFlameFigurineCloud(
        oneMap({ variations: { sphere: { type: 'spherical3D', weight: 1 } } }),
      ),
    ).toThrow('Unsupported flame figurine variation')
    expect(() =>
      sampleFlameFigurineCloud(
        oneMap({
          variations: {
            sphere: { type: 'spherical3D', weight: 1, visible: false },
            linear: { type: 'linear3D', weight: 1 },
          },
        }),
        { count: 1 },
      ),
    ).not.toThrow()
    expect(() => sampleFlameFigurineCloud(oneMap({ visible: false }))).toThrow(
      'positive visible map mass',
    )
    expect(() => sampleFlameFigurineCloud(oneMap(), { count: NaN })).toThrow(
      'count',
    )
  })

  it('supports native position colour initialization before the first map step', () => {
    const flame = oneMap({ colorSpeed: 0 })
    flame.renderSettings.colorInitMode = 'colorInitPosition'
    const cloud = sampleFlameFigurineCloud(flame, { count: 1, burnIn: 0 })
    expect(Array.from(cloud.colorCoordinates)).toEqual(
      Array.from(cloud.points.slice(0, 2)),
    )
  })

  it('refuses Clash walkers whose native team split and leaks override walk groups', () => {
    const template = map()
    const flame = validateFlame({
      ...oneMap(),
      transforms: {
        left: { ...template },
        right: { ...template },
      },
    })
    // Fight fields are runtime-only; the saved-flame parser deliberately strips them.
    const [left, right] = Object.values(flame.transforms)
    left!.team = 'A'
    right!.team = 'B'
    flame.renderSettings.clash = { split: 0.25, leakA: 0.1, leakB: 0 }
    expect(() => sampleFlameFigurineCloud(flame)).toThrow('Clash team walkers')
  })
})
