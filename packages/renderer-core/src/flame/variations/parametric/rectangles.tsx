import { f32, struct, vec2f } from 'typegpu/data'
import { floor } from 'typegpu/std'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type RectanglesParams = Infer<typeof RectanglesParams>
const RectanglesParams = struct({
  x: f32,
  y: f32,
})

const RectanglesParamsDefaults: RectanglesParams = {
  x: 2,
  y: 4,
}

export const rectanglesVar = parametricVariation(
  'rectanglesVar',
  RectanglesParams,
  RectanglesParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const p1 = P.x
    const p2 = P.y
    const p1Fact = 2 * floor(pos.x / p1) + 1
    const p2Fact = 2 * floor(pos.y / p2) + 1
    return vec2f(p1Fact * p1 - pos.x, p2Fact * p2 - pos.y)
  },
)
