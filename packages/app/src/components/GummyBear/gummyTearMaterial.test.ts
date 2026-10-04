/** Reflection samples remain centered, finite and radiance-normalized at runtime tear faces. */
import { d, std, tgpu } from 'typegpu'
import { describe, expect, it, vi } from 'vitest'
import { gummyEnvironment } from './gummyMaterial'
import { gummyTearAdjacency, gummyTearBody, gummyTearReflection, gummyTearReflectionDirection, } from './gummyTearMaterial'

describe('runtime tear reflection', () => {
  it('resolves unsigned packed wet weights without TypeGPU deprecation warnings', () => {
    const warn = vi.spyOn(console, 'warn')
    try {
      tgpu.resolve([gummyTearAdjacency], { names: 'strict' })
      expect(warn.mock.calls.flat().join(' ')).not.toContain('deprecated')
    } finally {
      warn.mockRestore()
    }
  })
  it('keeps intact skin unchanged and shares tear pigment continuously along a cut edge', () => {
    const bary = d.vec3f(0.25, 0.5, 0.25)
    expect(gummyTearAdjacency(0, bary)).toBe(0)
    expect(gummyTearAdjacency(0xffffff, bary)).toBe(1)
    expect(gummyTearAdjacency(255, bary)).toBe(0.25)
    expect(gummyTearAdjacency(128, d.vec3f(1, 0, 0))).toBeCloseTo(128 / 255, 7)
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const first = gummyTearAdjacency(0xff00ff, d.vec3f(t, 1 - t, 0))
      const adjacent = gummyTearAdjacency(0x00ff00, d.vec3f(1 - t, t, 0))
      expect(first).toBe(t)
      expect(adjacent).toBe(first)
    }
  })
  it('keeps the centre ray and a symmetric finite lobe even at basis poles', () => {
    for (const ray of [d.vec3f(0, 1, 0), d.vec3f(0, -1, 0), d.vec3f(1, 0, 0)]) {
      expect(Array.from(gummyTearReflectionDirection(ray, d.vec2f(0)))).toEqual(
        Array.from(ray),
      )
      const positive = gummyTearReflectionDirection(ray, d.vec2f(0.55, 0.55))
      const negative = gummyTearReflectionDirection(ray, d.vec2f(-0.55, -0.55))
      expect(std.length(positive)).toBeCloseTo(1, 6)
      expect(std.length(negative)).toBeCloseTo(1, 6)
      const midpoint = std.normalize(std.add(positive, negative))
      for (let axis = 0; axis < 3; axis++)
        expect(midpoint[axis]).toBeCloseTo(ray[axis]!, 6)
    }
  })

  it('spreads a bright studio card over a finite reflected lobe without whitening every face', () => {
    const card = std.normalize(d.vec3f(0.28, 0.79, 0.55))
    const sharp = gummyEnvironment(card)
    const rough = gummyTearReflection(card)
    expect(sharp.x).toBeGreaterThan(5)
    expect(rough.x).toBeGreaterThan(0.1)
    expect(rough.x).toBeLessThan(sharp.x * 0.5)
    for (const ray of [card, d.vec3f(0, 1, 0), d.vec3f(0, -1, 0), d.vec3f(0)]) {
      const colour = gummyTearReflection(ray)
      for (const channel of colour) {
        expect(Number.isFinite(channel)).toBe(true)
        expect(channel).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('resolves actual normalized angular quadrature to WGSL', () => {
    const source = tgpu.resolve([gummyTearReflection], { names: 'strict' })
    expect(source).toContain('gummyTearReflectionDirection')
    expect(source).toContain('gummyEnvironment')
    expect(source).not.toContain('NaN')
  })

  it('retains blue and berry pigment when a thin cut transmits a neutral floor', () => {
    const floor = d.vec3f(0.7)
    const blue = gummyTearBody(floor, d.vec3f(0.006, 0.26, 0.64), 0.5)
    const berry = gummyTearBody(floor, d.vec3f(0.3, 0.0015, 0.007), 0.5)
    expect(blue.x).toBeCloseTo(0.048704, 5)
    expect(blue.y).toBeCloseTo(0.366915, 5)
    expect(blue.z).toBeCloseTo(0.6244, 5)
    expect(berry.x).toBeCloseTo(0.553, 5)
    expect(berry.y).toBeCloseTo(0.034963, 5)
    expect(berry.z).toBeCloseTo(0.076319, 5)
  })

  it('preserves neutral dye, bounds each channel and handles black pigment', () => {
    expect(Array.from(gummyTearBody(d.vec3f(0.5), d.vec3f(0.5), 1))).toEqual([
      0.5, 0.5, 0.5,
    ])
    expect(Array.from(gummyTearBody(d.vec3f(1), d.vec3f(0), 0))).toEqual([
      0, 0, 0,
    ])
    for (const dye of [
      d.vec3f(0.3, 0.0015, 0.007),
      d.vec3f(0.006, 0.26, 0.64),
    ]) {
      const body = d.vec3f(4, 2, 1)
      const filtered = gummyTearBody(body, dye, 1)
      for (let channel = 0; channel < 3; channel++) {
        expect(filtered[channel]).toBeLessThanOrEqual(body[channel]!)
        expect(filtered[channel]).toBeGreaterThanOrEqual(0)
      }
    }
    const source = tgpu.resolve([gummyTearBody], { names: 'strict' })
    expect(source).toContain('sqrt')
    expect(source).not.toContain('NaN')
  })
})
