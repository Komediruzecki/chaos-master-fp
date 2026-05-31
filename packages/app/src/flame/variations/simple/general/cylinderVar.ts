import { vec2f } from 'typegpu/data'
import { sin } from 'typegpu/std'
import { simpleVariation } from '../types'

export const cylinderVar = simpleVariation(
  'cylinderVar',
  (pos, _varInfo) => {
    'use gpu'
    return vec2f(sin(pos.x), pos.y)
  },
  'general',
)
