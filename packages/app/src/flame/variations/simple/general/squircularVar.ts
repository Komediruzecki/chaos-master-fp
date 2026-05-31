import { vec2f } from 'typegpu/data'
import { select, sqrt } from 'typegpu/std'
import { simpleVariation } from '../types'

export const squircularVar = simpleVariation(
  'squircularVar',
  (pos, varInfo) => {
    'use gpu'
    const w = varInfo.weight
    const u = pos.x
    const v = pos.y
    const r2 = u * u + v * v
    const rs = sqrt(r2)
    const xs = select(-1.0, 1.0, u > 0.0)
    let r = sqrt(w * w * r2 - 4.0 * u * u * v * v)
    r = sqrt(1.0 + (u * u) / (v * v) - (rs / (w * v * v)) * r)
    r = r / sqrt(2.0)
    return vec2f(xs * r, (v / u) * r)
  },
  'general',
)
