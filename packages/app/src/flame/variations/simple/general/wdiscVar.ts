import { vec2f } from 'typegpu/data'
import { atan2, cos, sin, sqrt } from 'typegpu/std'
import { PI } from '@/flame/constants'
import { simpleVariation } from '../types'

export const wdiscVar = simpleVariation(
  'wdiscVar',
  (pos, _varInfo) => {
    'use gpu'
    const M_1_PI = 1.0 / PI.$
    const aBase = PI.$ / (sqrt(pos.x * pos.x + pos.y * pos.y) + 1.0)
    const r = atan2(pos.y, pos.x) * M_1_PI
    const a = r > 0.0 ? PI.$ - aBase : aBase
    return vec2f(r * cos(a), r * sin(a))
  },
  'general',
)
