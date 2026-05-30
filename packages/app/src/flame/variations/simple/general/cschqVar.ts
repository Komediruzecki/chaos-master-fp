import { vec2f } from 'typegpu/data'
import { cos, cosh, sin, sinh, sqrt } from 'typegpu/std'
import { simpleVariation } from '../types'

export const cschqVar = simpleVariation(
  'cschqVar',
  (pos, varInfo) => {
    'use gpu'

    const z = 0.0
    const abs_v = sqrt(pos.y * pos.y + z * z)
    const s = sin(abs_v)
    const c = cos(abs_v)
    const sh = sinh(pos.x)
    const ch = cosh(pos.x)

    const denom = pos.x * pos.x + pos.y * pos.y + z * z
    const ni = varInfo.weight / (denom === 0.0 ? 1.0e-9 : denom)

    const C = (ni * ch * s) / (abs_v === 0.0 ? 1.0e-9 : abs_v)

    const newX = sh * c * ni
    const newY = -(C * pos.y)

    return vec2f(newX, newY)
  },
  'general',
)
