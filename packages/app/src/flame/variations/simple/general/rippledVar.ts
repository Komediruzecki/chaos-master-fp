import { vec2f } from 'typegpu/data'
import { cos, tanh } from 'typegpu/std'
import { EPS } from '../../../constants'
import { simpleVariation } from '../types'

export const rippledVar = simpleVariation(
  'rippledVar',
  (pos, _varInfo) => {
    'use gpu'
    const d = pos.x * pos.x + pos.y * pos.y
    const safeD = d + EPS.$
    return vec2f(tanh(safeD) * pos.x, cos(safeD) * pos.y)
  },
  'general',
)
