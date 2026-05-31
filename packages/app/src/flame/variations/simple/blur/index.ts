import { vec2f } from 'typegpu/data'
import { abs, cos, sin, sqrt } from 'typegpu/std'
import { random } from '@/shaders/random'
import { PI } from '../../../constants'
import { simpleVariation } from '../types'

export const blurCircle = simpleVariation(
  'blurCircle',
  (_pos, varInfo) => {
    'use gpu'
    const weight = varInfo.weight
    const randX = 2 * random() - 1
    const randY = 2 * random() - 1
    const absX = abs(randX)
    const absY = abs(randY)

    let side = absX
    let perimeter = absX
    if (absX >= absY) {
      side = absX
      perimeter = randX >= absY ? absX + randY : 5 * absX - randY
    } else {
      side = absY
      perimeter = randY >= absX ? 3 * absY - randX : 7 * absY + randX
    }

    const r = weight * side
    const theta = (PI.$ / 4) * (perimeter / side) - PI.$ / 4
    return vec2f(r * cos(theta), r * sin(theta))
  },
  'blur',
)

export const gaussianBlur = simpleVariation(
  'gaussianBlur',
  (_pos, _varInfo) => {
    'use gpu'
    const r = random() + random() + random() + random() - 2
    const theta = random() * 2 * PI.$
    return vec2f(cos(theta), sin(theta)).mul(r)
  },
  'blur',
)

export const circleBlur = simpleVariation(
  'circleBlur',
  (_pos, _varInfo) => {
    'use gpu'
    const rad = sqrt(random())
    const a = random() * 2 * PI.$
    return vec2f(cos(a), sin(a)).mul(rad)
  },
  'blur',
)
