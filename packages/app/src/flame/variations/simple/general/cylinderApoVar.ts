import { vec2f } from 'typegpu/data'
import { sin } from 'typegpu/std'
import { simpleVariation } from '../types'

export const cylinderApoVar = simpleVariation(
  'cylinderApoVar',
  (pos, _varInfo) => {
    'use gpu'
    return vec2f(sin(pos.x), pos.y)
  },
  'general',
)
