import { dot } from 'typegpu/std'
import { EPS } from '@/flame/constants'
import { simpleVariation } from '../types'

export const sphericalVar = simpleVariation(
  'sphericalVar',
  (pos, _varInfo) => {
    'use gpu'
    const r2 = dot(pos, pos) + EPS.$
    return pos.div(r2)
  },
  'general',
)
