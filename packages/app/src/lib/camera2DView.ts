import { mat3x3f, mat4x4f } from 'typegpu/data'
import { mat4 } from 'wgpu-matrix'

/**
 * What the 2D camera does to the picture, as a matrix.
 *
 * Every point the IFS renderer plots goes through `camera2DWorldToClip`, and
 * that function is nothing but this matrix (see `flame/ifsPipeline.ts`). Kept
 * out of the component so the framing can be checked with numbers instead of
 * with a GPU and a screenshot.
 */
export type Camera2DView = {
  /** Camera centre in world units: what sits in the middle of the canvas. */
  x: number
  y: number
  /** Zoom 1 shows two world units of height; zoom 2 shows one. */
  zoom: number
  /** Canvas width / height. */
  aspect: number
}

/**
 * World -> clip, column-major: `clip = c0 * world.x + c1 * world.y + c2`.
 */
export function camera2DViewMatrix({ x, y, zoom, aspect }: Camera2DView) {
  const viewMatrix4 = mat4x4f()
  const fovy = 1 / zoom
  // near/far are -1/1 (not 0/0): the projection is 2D, so the z entries are
  // unused (only the xyw of columns 0/1/3 are read below), but 0/0 makes
  // ortho write NaN/Inf into those entries, which TypeGPU 0.11 rejects
  // (Finite Math Assumption).
  mat4.ortho(
    x - aspect * fovy,
    x + aspect * fovy,
    y - fovy,
    y + fovy,
    -1,
    1,
    viewMatrix4,
  )
  // prettier-ignore
  return mat3x3f(
    viewMatrix4.columns[0].xyw,
    viewMatrix4.columns[1].xyw,
    viewMatrix4.columns[3].xyw,
  )
}
