import { vec2f } from 'typegpu/data'
import { cos, cosh, sin, sinh } from 'typegpu/std'
import { simpleVariation } from '../types'

export const cosVar = simpleVariation(
  'cosVar',
  (pos, _varInfo) => {
    'use gpu'
    return vec2f(cos(pos.x) * cosh(pos.y), -sin(pos.x) * sinh(pos.y))
  },
  'general',
)
