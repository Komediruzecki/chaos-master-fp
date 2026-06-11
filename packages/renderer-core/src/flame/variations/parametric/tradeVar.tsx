import { f32, struct, vec2f } from 'typegpu/data'
import { atan2, cos, sin, sqrt } from 'typegpu/std'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

const TradeVarParams = struct({
  r1: f32,
  d1: f32,
  r2: f32,
  d2: f32,
})

type TradeVarParams = Infer<typeof TradeVarParams>

const TradeVarParamsDefaults: TradeVarParams = {
  r1: 1.0,
  d1: 1.0,
  r2: 1.0,
  d2: 1.0,
}

export const tradeVar = parametricVariation(
  'tradeVar',
  TradeVarParams,
  TradeVarParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const _c1 = P.r1 + P.d1
    const _c2 = P.r2 + P.d2
    let newX = f32(0.0)
    let newY = f32(0.0)

    if (pos.x > 0.0) {
      let r = sqrt((_c1 - pos.x) * (_c1 - pos.x) + pos.y * pos.y)
      if (r <= P.r1) {
        r *= P.r2 / P.r1
        const a = atan2(pos.y, _c1 - pos.x)
        const s = sin(a)
        const c = cos(a)
        newX = r * c - _c2
        newY = r * s
      } else {
        newX = pos.x
        newY = pos.y
      }
    } else {
      let r = sqrt((-_c2 - pos.x) * (-_c2 - pos.x) + pos.y * pos.y)
      if (r <= P.r2) {
        r *= P.r1 / P.r2
        const a = atan2(pos.y, -_c2 - pos.x)
        const s = sin(a)
        const c = cos(a)
        newX = r * c + _c1
        newY = r * s
      } else {
        newX = pos.x
        newY = pos.y
      }
    }

    return vec2f(newX, newY)
  },
)
