import { vec2f } from 'typegpu/data'
import { cos, sin } from 'typegpu/std'
import { PI } from '@/flame/constants'
import { random } from '@/shaders/random'
import { simpleVariation } from '../types'

export const chrysanthemumVar = simpleVariation(
  'chrysanthemumVar',
  (pos, varInfo) => {
    'use gpu'

    const u = 21.0 * PI.$ * random()
    const p4 = sin((17.0 * u) / 3.0)
    const p8 = sin(2.0 * cos(3.0 * u) - 28.0 * u)

    const p4_2 = p4 * p4
    const p4_4 = p4_2 * p4_2

    const p8_2 = p8 * p8
    const p8_4 = p8_2 * p8_2
    const p8_8 = p8_4 * p8_4

    let r = 5.0 * (1.0 + sin((11.0 * u) / 5.0)) - 4.0 * p4_4 * p8_8

    r = r * varInfo.weight * 0.1

    const newX = r * cos(u)
    const newY = r * sin(u)

    return vec2f(newX, newY)
  },
  'general',
)
