/**
 * The framing arithmetic behind the floating tablet deck: how much of the
 * canvas it covers, where the camera's centre goes, and which part of an
 * image of the canvas is the picture (lib/canvasFraming.ts).
 */
import { mat4x4f } from 'typegpu/data'
import { describe, expect, it } from 'vitest'
import { mat4 } from 'wgpu-matrix'
import { coveredFraction, framingShift, MAX_COVERED_FRACTION, NO_SHIFT, shiftClipTransform, visibleAspect, visibleRegion, } from './canvasFraming'

describe('coveredFraction', () => {
  it('is the deck width over the canvas width', () => {
    // 1180 x 820 landscape: an 80 px rail, then a canvas 1100 px wide that
    // runs under a 380 px deck.
    expect(coveredFraction(380, 1100)).toBeCloseTo(0.345455, 6)
  })

  it('is 0 for no cover and for a canvas not yet laid out', () => {
    expect(coveredFraction(0, 1100)).toBe(0)
    expect(coveredFraction(380, 0)).toBe(0)
    expect(coveredFraction(380, Number.NaN)).toBe(0)
    expect(coveredFraction(Number.NaN, 1100)).toBe(0)
    expect(coveredFraction(-10, 1100)).toBe(0)
  })

  it('stops short of the whole canvas', () => {
    expect(coveredFraction(2000, 1000)).toBe(MAX_COVERED_FRACTION)
  })
})

describe('framingShift', () => {
  it('puts the centre in the middle of the uncovered part', () => {
    const shift = framingShift(coveredFraction(380, 1100))
    // In pixels: the canvas centre is at 550, the visible part's at 360,
    // 190 px (half the deck) to the left. In clip units that is 190 / 550.
    expect(shift.x).toBeCloseTo(-190 / 550, 6)
    expect(shift.y).toBe(0)
  })

  it('is no shift at all when nothing covers the canvas', () => {
    expect(framingShift(0)).toBe(NO_SHIFT)
    expect(framingShift(Number.NaN)).toBe(NO_SHIFT)
  })
})

describe('visibleRegion', () => {
  it('keeps the uncovered width and the whole height, from the left', () => {
    const fraction = coveredFraction(380, 1100)
    expect(visibleRegion(1100, 820, fraction)).toEqual({
      x: 0,
      y: 0,
      width: 720,
      height: 820,
    })
    // An iPad's backing store, at twice the CSS size.
    expect(visibleRegion(2200, 1640, fraction)).toEqual({
      x: 0,
      y: 0,
      width: 1440,
      height: 1640,
    })
  })

  it('is the whole image when nothing covers it', () => {
    expect(visibleRegion(1100, 820, 0)).toEqual({
      x: 0,
      y: 0,
      width: 1100,
      height: 820,
    })
  })

  it('keeps at least a pixel, and never more than the image', () => {
    expect(visibleRegion(3, 3, MAX_COVERED_FRACTION).width).toBe(1)
    expect(visibleRegion(0, 0, 0.5).width).toBe(0)
  })
})

describe('visibleAspect', () => {
  it('is the aspect of what the deck leaves visible', () => {
    // The setting-off canvas is exactly that part: 720 x 820.
    expect(visibleAspect(1100, 820, coveredFraction(380, 1100))).toBeCloseTo(
      720 / 820,
      6,
    )
  })

  it('is the canvas aspect when nothing covers it', () => {
    expect(visibleAspect(1100, 820, 0)).toBeCloseTo(1100 / 820, 6)
    expect(visibleAspect(1100, 0, 0)).toBe(1)
  })
})

describe('shiftClipTransform', () => {
  const project = (m: ArrayLike<number>, p: readonly number[]) => {
    const [x, y, z] = p as [number, number, number]
    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
    return [cx / cw, cy / cw]
  }
  const viewProjection = () => {
    const view = mat4.lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0])
    const projection = mat4.perspective(Math.PI / 3, 1100 / 820, 0.01, 100)
    return mat4.mul(projection, view)
  }

  it('moves the target, the vanishing point, by the shift', () => {
    const shifted = shiftClipTransform(viewProjection(), { x: -0.3, y: 0 })
    const [x, y] = project(shifted, [0, 0, 0])
    expect(x).toBeCloseTo(-0.3, 6)
    expect(y).toBeCloseTo(0, 6)
  })

  it('moves every point by the same amount on screen, near or far', () => {
    const plain = viewProjection()
    const shifted = shiftClipTransform(viewProjection(), { x: -0.3, y: 0.1 })
    for (const point of [
      [1, 0.5, 0],
      [-2, 1, -3],
      [0.5, -1, 2],
    ]) {
      const [px, py] = project(plain, point)
      const [sx, sy] = project(shifted, point)
      expect(sx! - px!).toBeCloseTo(-0.3, 5)
      expect(sy! - py!).toBeCloseTo(0.1, 5)
    }
  })

  it('writes the matrix it is given, and leaves it be for no shift', () => {
    const matrix = viewProjection()
    const before = Array.from(matrix)
    expect(shiftClipTransform(matrix, NO_SHIFT)).toBe(matrix)
    expect(Array.from(matrix)).toEqual(before)

    expect(shiftClipTransform(matrix, { x: -0.3, y: 0 })).toBe(matrix)
    expect(Array.from(matrix)).not.toEqual(before)
  })

  it('shifts the GPU matrix type the camera writes to its uniforms', () => {
    // Camera3D builds a typegpu mat4x4f, whose elements are accessors.
    const matrix = mat4.mul(
      mat4.perspective(Math.PI / 3, 1100 / 820, 0.01, 100),
      mat4.lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]),
      mat4x4f(),
    )
    shiftClipTransform(matrix, { x: -0.3, y: 0 })
    const [x, y] = project(matrix, [0, 0, 0])
    expect(x).toBeCloseTo(-0.3, 6)
    expect(y).toBeCloseTo(0, 6)
  })
})
