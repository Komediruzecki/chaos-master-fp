import { vec2f } from 'typegpu/data'
import { cos, sin } from 'typegpu/std'
import { PI } from '@/flame/constants'
import { random } from '@/shaders/random'
import { simpleVariation } from '../types'

export const noiseVar = simpleVariation(
  'noiseVar',
  (pos, _varInfo) => {
    'use gpu'
    const rand = random()
    const angle = 2.0 * PI.$ * random()
    return vec2f(pos.x * cos(angle), pos.y * sin(angle)).mul(rand)
  },
  'general',
)
