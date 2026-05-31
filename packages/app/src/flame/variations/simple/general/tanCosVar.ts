import { vec2f } from 'typegpu/data'
import { cos, tanh } from 'typegpu/std'
import { EPS } from '@/flame/constants'
import { simpleVariation } from '../types'

export const tanCosVar = simpleVariation(
  'tanCosVar',
  (pos, _varInfo) => {
    'use gpu'
    const d1 = pos.x * pos.x + pos.y * pos.y + EPS.$
    const d2 = 1.0 / d1
    return vec2f(d2 * tanh(d1) * 2.0 * pos.x, d2 * cos(d1) * 2.0 * pos.y)
  },
  'general',
)
