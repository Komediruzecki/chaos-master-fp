import { vec2f } from 'typegpu/data'
import { sin, tan } from 'typegpu/std'
import { simpleVariation } from '../types'

export const popcornVar = simpleVariation(
  'popcornVar',
  (pos, varInfo) => {
    'use gpu'
    const T = varInfo.affineCoefs
    const delta = vec2f(
      T.c * sin(tan(3.0 * pos.y)),
      T.f * sin(tan(3.0 * pos.x)),
    )
    return pos.add(delta)
  },
  'general',
)
