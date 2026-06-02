import { vec2f } from 'typegpu/data'
import { select, sqrt } from 'typegpu/std'
import { random } from '@/shaders/random'
import { EPS } from '../../../constants'
import { simpleVariation } from '../types'

export const dustpointVar = simpleVariation(
  'dustpointVar',
  (pos, _varInfo) => {
    'use gpu'
    const p = select(-1.0, 1.0, random() < 0.5)
    const r = sqrt(pos.x * pos.x + pos.y * pos.y) + EPS.$
    const w = random()
    let x = pos.x
    let y = pos.y
    if (w < 0.5) {
      x = pos.x / r - 1.0
      y = (p * pos.y) / r
    } else if (w < 0.75) {
      x = pos.x / 3.0
      y = pos.y / 3.0
    } else {
      x = pos.x / 3.0 + 2.0 / 3.0
      y = pos.y / 3.0
    }
    return vec2f(x, y)
  },
  'general',
)
