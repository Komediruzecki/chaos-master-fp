import { vec2f } from 'typegpu/data'
import { simpleVariation } from '../types'

export const flipYVar = simpleVariation(
  'flipYVar',
  (pos, _varInfo) => {
    'use gpu'
    const sign = pos.x > 0.0 ? -1.0 : 1.0
    return vec2f(pos.x, sign * pos.y)
  },
  'general',
)
