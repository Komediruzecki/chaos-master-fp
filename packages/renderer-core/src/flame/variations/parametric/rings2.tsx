import { f32, struct, vec2f } from 'typegpu/data'
import { atan2, cos, length, sin, trunc } from 'typegpu/std'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type Rings2Params = Infer<typeof Rings2Params>
const Rings2Params = struct({
  val: f32,
})

const Rings2ParamsDefaults: Rings2Params = {
  val: 6,
}

export const rings2 = parametricVariation(
  'rings2',
  Rings2Params,
  Rings2ParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const p = P.val
    const r = length(pos)
    const theta = atan2(pos.y, pos.x)
    const twop = 2 * p
    const t = r - twop * trunc((r + p) / twop) + r * (1 - p)
    return vec2f(sin(theta), cos(theta)).mul(t)
  },
)
