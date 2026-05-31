import { vec2f } from 'typegpu/data'
import { atan2, log } from 'typegpu/std'
import { simpleVariation } from '../types'

export const logVar = simpleVariation(
  'logVar',
  (pos, _varInfo) => {
    'use gpu'
    const r2 = pos.x * pos.x + pos.y * pos.y
    return vec2f(0.5 * log(r2), atan2(pos.y, pos.x))
  },
  'general',
)
