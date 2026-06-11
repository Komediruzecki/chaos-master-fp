import { f32, struct, vec2f } from 'typegpu/data'
import { atan2, cos, length, log, sin } from 'typegpu/std'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

const Swirl3VarParams = struct({
  shift: f32,
})

type Swirl3VarParams = Infer<typeof Swirl3VarParams>

const Swirl3VarParamsDefaults: Swirl3VarParams = {
  shift: 5,
}

export const swirl3Var = parametricVariation(
  'swirl3Var',
  Swirl3VarParams,
  Swirl3VarParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const rad = length(pos)
    const ang = atan2(pos.y, pos.x) + log(rad) * P.shift
    const s = sin(ang)
    const c = cos(ang)

    return vec2f(rad * c, rad * s)
  },
)
