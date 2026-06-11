import { f32, struct, vec2f } from 'typegpu/data'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type CurlParams = Infer<typeof CurlParams>
const CurlParams = struct({
  c1: f32,
  c2: f32,
})

const CurlParamsDefaults: CurlParams = {
  c1: 1,
  c2: 1,
}

export const curlVar = parametricVariation(
  'curlVar',
  CurlParams,
  CurlParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const p1 = P.c1
    const p2 = P.c2
    const squareDiff = pos.x * pos.x - pos.y * pos.y
    const t1 = 1 + p1 * pos.x + p2 * squareDiff
    const t2 = p1 * pos.y + 2 * p2 * pos.x * pos.y
    const tSqSum = t1 * t1 + t2 * t2
    const factor = 1 / tSqSum
    return vec2f(pos.x * t1 + pos.y * t2, pos.y * t1 - pos.x * t2).mul(factor)
  },
)
