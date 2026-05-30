import { vec2f } from 'typegpu/data'
import { floor, pow, sqrt } from 'typegpu/std'
import { random } from '@/shaders/random'
import { simpleVariation } from '../types'

export const apollonyVar = simpleVariation(
  'apollonyVar',
  (pos, varInfo) => {
    'use gpu'

    const r = sqrt(3.0)

    const term1 = 1.0 + r - pos.x
    const denom = pow(term1, 2.0) + pos.y * pos.y + 1.0e-10

    const a0 = (3.0 * term1) / denom - (1.0 + r) / (2.0 + r)
    const b0 = (3.0 * pos.y) / denom

    const f1x = a0 / (a0 * a0 + b0 * b0 + 1.0e-10)
    const f1y = -b0 / (a0 * a0 + b0 * b0 + 1.0e-10)

    const w = floor(4.0 * random())

    let newX = 0.0
    let newY = 0.0

    if (w === 0.0) {
      newX = f1x
      newY = f1y
    } else if (w === 1.0) {
      newX = 0.5 * (f1x - r * f1y)
      newY = 0.5 * (f1y * r + f1x)
    } else if (w === 2.0) {
      newX = 0.5 * (f1x + r * f1y)
      newY = 0.5 * (r * f1y - f1x)
    } else {
      newX = 0.5 * (f1x + r * f1y)
      newY = 0.5 * (r * f1y - f1x)

      newX = f1x
      newY = f1y
    }

    return vec2f(newX * varInfo.weight, newY * varInfo.weight)
  },
  'general',
)
