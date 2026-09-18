import { vec3f } from 'typegpu/data'
import { mul } from 'typegpu/std'
import { describe, expect, it } from 'vitest'
import { camera2DViewMatrix } from './camera2DView'
import type { Camera2DView } from './camera2DView'

/** Where a world point lands on screen, in clip units (-1..1 is the canvas). */
const project = (view: Camera2DView, wx: number, wy: number) => {
  const clip = mul(camera2DViewMatrix(view), vec3f(wx, wy, 1))
  return { x: clip.x / clip.z, y: clip.y / clip.z }
}

const VIEW: Camera2DView = { x: 0, y: 0, zoom: 1, aspect: 1 }

describe('the 2D camera view matrix', () => {
  it('shows two world units of height at zoom 1', () => {
    expect(project(VIEW, 0, 1)).toMatchObject({ x: 0, y: 1 })
    expect(project(VIEW, 0, -1).y).toBeCloseTo(-1)
  })

  it('halves what fits for every doubling of the zoom', () => {
    expect(project({ ...VIEW, zoom: 2 }, 0, 0.5).y).toBeCloseTo(1)
  })

  it('puts the camera centre in the middle of the canvas', () => {
    const panned = { ...VIEW, x: 3, y: -2 }
    expect(project(panned, 3, -2).x).toBeCloseTo(0)
    expect(project(panned, 3, -2).y).toBeCloseTo(0)
  })

  it('spends the extra width on x, so a wide canvas shows more world', () => {
    // The height is the fixed side: aspect only ever widens the x range.
    expect(project({ ...VIEW, aspect: 2 }, 2, 0).x).toBeCloseTo(1)
    expect(project({ ...VIEW, aspect: 2 }, 0, 1).y).toBeCloseTo(1)
  })
})
