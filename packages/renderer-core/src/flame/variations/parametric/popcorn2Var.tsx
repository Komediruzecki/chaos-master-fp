import { f32, struct, vec2f } from 'typegpu/data'
import { sin, tan } from 'typegpu/std'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

const Popcorn2VarParams = struct({
  x: f32,
  y: f32,
  c: f32,
})

type Popcorn2VarParams = Infer<typeof Popcorn2VarParams>

const Popcorn2VarParamsDefaults: Popcorn2VarParams = {
  x: 1.0,
  y: 0.5,
  c: 1.5,
}

export const popcorn2Var = parametricVariation(
  'popcorn2Var',
  Popcorn2VarParams,
  Popcorn2VarParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const newX = pos.x + P.x * sin(tan(pos.y * P.c))
    const newY = pos.y + P.y * sin(tan(pos.x * P.c))

    return vec2f(newX, newY)
  },
)
