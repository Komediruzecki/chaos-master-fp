import { f32, struct, vec2f } from 'typegpu/data'
import { cos, sin } from 'typegpu/std'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type PerspectiveParams = Infer<typeof PerspectiveParams>
const PerspectiveParams = struct({
  angle: f32,
  dist: f32,
})

const PerspectiveParamsDefaults: PerspectiveParams = {
  angle: Math.PI,
  dist: 3,
}

export const perspective = parametricVariation(
  'perspective',
  PerspectiveParams,
  PerspectiveParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const p1 = P.angle
    const p2 = P.dist
    const factor = p2 / (p2 - pos.y * sin(p1))
    return vec2f(pos.x, pos.y * cos(p1)).mul(factor)
  },
)
