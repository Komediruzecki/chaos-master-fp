import { vec2f } from 'typegpu/data'
import { cos, select, sqrt } from 'typegpu/std'
import { simpleVariation } from '../types'

export const secant2Var = simpleVariation(
  'secant2Var',
  (pos, varInfo) => {
    'use gpu'
    const r = varInfo.weight * sqrt(pos.x * pos.x + pos.y * pos.y)
    const cr = cos(r)
    const icosr = 1.0 / cr
    const yOff = select(-1.0, 1.0, icosr < 0.0)
    return vec2f(pos.x, icosr + yOff)
  },
  'general',
)
