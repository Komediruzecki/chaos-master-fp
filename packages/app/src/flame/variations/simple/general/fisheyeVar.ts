import { length } from 'typegpu/std'
import { simpleVariation } from '../types'

export const fisheyeVar = simpleVariation(
  'fisheyeVar',
  (pos, _varInfo) => {
    'use gpu'
    const factor = 2.0 / (length(pos) + 1.0)
    return pos.yx.mul(factor)
  },
  'general',
)
