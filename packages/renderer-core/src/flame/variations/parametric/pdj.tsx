import { f32, struct, vec2f } from 'typegpu/data'
import { cos, sin } from 'typegpu/std'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type PdjParams = Infer<typeof PdjParams>
const PdjParams = struct({
  a: f32,
  b: f32,
  c: f32,
  d: f32,
})

const PdjParamsDefaults: PdjParams = {
  a: 1,
  b: 2,
  c: 3,
  d: 4,
}

export const pdjVar = parametricVariation(
  'pdjVar',
  PdjParams,
  PdjParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const p1 = P.a
    const p2 = P.b
    const p3 = P.c
    const p4 = P.d
    return vec2f(
      sin(p1 * pos.y) - cos(p2 * pos.x),
      sin(p3 * pos.x) - cos(p4 * pos.y),
    )
  },
)
