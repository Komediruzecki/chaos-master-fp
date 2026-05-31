import { vec2f } from 'typegpu/data'
import { cos, cosh, sin, sinh } from 'typegpu/std'
import { simpleVariation } from '../types'

export const coshVar = simpleVariation(
  'coshVar',
  (pos, _varInfo) => {
    'use gpu'
    return vec2f(cosh(pos.x) * cos(pos.y), sinh(pos.x) * sin(pos.y))
  },
  'general',
)
