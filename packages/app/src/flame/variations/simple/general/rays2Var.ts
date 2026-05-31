import { vec2f } from 'typegpu/data'
import { cos, dot, tan } from 'typegpu/std'
import { EPS } from '../../../constants'
import { simpleVariation } from '../types'

export const rays2Var = simpleVariation(
  'rays2Var',
  (pos, _varInfo) => {
    'use gpu'
    const t = dot(pos, pos)
    const inner = (t + EPS.$) * tan(1.0 / t + EPS.$)
    const u = 1.0 / cos(inner)
    const factor = u * t * 0.1
    return vec2f(factor / pos.x, factor / pos.y)
  },
  'general',
)
