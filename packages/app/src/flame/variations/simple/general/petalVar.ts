import { vec2f } from 'typegpu/data'
import { cos, sin } from 'typegpu/std'
import { simpleVariation } from '../types'

export const petalVar = simpleVariation(
  'petalVar',
  (pos, _varInfo) => {
    'use gpu'
    const cx = cos(pos.x)
    const cy = cos(pos.y)
    const sxy = sin(pos.x) * cy
    const cxy = cx * cy
    const bx = cxy * cxy * cxy
    const by = sxy * sxy * sxy
    return vec2f(cx * bx, cx * by)
  },
  'general',
)
