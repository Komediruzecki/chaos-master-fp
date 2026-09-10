import { describe, expect, it } from 'vitest'
import { isUsablePinch, pinchEventFrom } from './createPinchHandler'

const p = (clientX: number, clientY: number) => ({ clientX, clientY })

describe('pinchEventFrom', () => {
  it('computes midpoint and distance for two distinct touches', () => {
    const e = pinchEventFrom(p(0, 0), p(6, 8))
    expect(e.midpoint).toEqual({ clientX: 3, clientY: 4 })
    expect(e.distance).toBe(10)
  })
})

describe('isUsablePinch', () => {
  it('rejects two coincident touches, which is what a fast two-finger tap reports', () => {
    expect(isUsablePinch(pinchEventFrom(p(120, 240), p(120, 240)))).toBe(false)
  })

  it('rejects a non-finite coordinate', () => {
    expect(isUsablePinch(pinchEventFrom(p(NaN, 0), p(6, 8)))).toBe(false)
    expect(isUsablePinch(pinchEventFrom(p(0, 0), p(Infinity, 8)))).toBe(false)
  })

  it('accepts an ordinary pinch', () => {
    expect(isUsablePinch(pinchEventFrom(p(0, 0), p(6, 8)))).toBe(true)
  })
})

describe('the ratio a consumer computes from two usable events', () => {
  it('is always finite and positive, so a clamp cannot yield NaN', () => {
    const prev = pinchEventFrom(p(0, 0), p(6, 8))
    const next = pinchEventFrom(p(0, 0), p(12, 16))
    const ratio = next.distance / prev.distance
    expect(Number.isFinite(ratio)).toBe(true)
    expect(ratio).toBeGreaterThan(0)
    expect(Math.max(0.1, Math.min(1000, 5 / ratio))).toBe(2.5)
  })

  it('documents why the guard has to be upstream: Math.min/max propagate NaN', () => {
    const degenerate = pinchEventFrom(p(50, 50), p(50, 50))
    const ratio = degenerate.distance / degenerate.distance // 0 / 0
    expect(Number.isNaN(ratio)).toBe(true)
    expect(Number.isNaN(Math.max(0.1, Math.min(1000, 5 / ratio)))).toBe(true)
  })
})
