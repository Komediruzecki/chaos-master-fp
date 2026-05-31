import { vec2f } from 'typegpu/data'
import { atan2, cos, length, sin } from 'typegpu/std'
import { simpleVariation } from '../types'

export const spiralVar = simpleVariation(
  'spiralVar',
  (pos, _varInfo) => {
    'use gpu'
    const r = length(pos)
    const theta = atan2(pos.y, pos.x)
    return vec2f(cos(theta) + sin(r), sin(theta) - cos(r)).div(r)
  },
  'general',
)
