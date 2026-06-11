import { f32, struct, vec2f } from 'typegpu/data'
import { atan2, cos, length, select, sin, trunc } from 'typegpu/std'
import { PI } from '@/flame/constants'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type Fan2Params = Infer<typeof Fan2Params>
const Fan2Params = struct({
  x: f32,
  y: f32,
})

const Fan2ParamsDefaults: Fan2Params = {
  x: 1,
  y: 1,
}

export const fan2 = parametricVariation(
  'fan2',
  Fan2Params,
  Fan2ParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const p1 = PI.$ * P.x * P.x
    const p2 = P.y
    const theta = atan2(pos.y, pos.x)
    const t = theta + p2 - p1 * trunc((2 * theta * p2) / p1)
    const r = length(pos)

    const p1half = p1 / 2
    const trueAngle = theta - p1half
    const falseAngle = theta + p1half
    const angle = select(falseAngle, trueAngle, t > p1half)
    return vec2f(sin(angle), cos(angle)).mul(r)
  },
)
