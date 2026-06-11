import { f32, struct, vec2f } from 'typegpu/data'
import { abs, atan2, cos, length, pow, sin, trunc } from 'typegpu/std'
import { PI } from '@/flame/constants'
import { random } from '@/shaders/random'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type JuliaNParams = Infer<typeof JuliaNParams>
const JuliaNParams = struct({
  power: f32,
  dist: f32,
})

const JuliaNParamsDefaults: JuliaNParams = {
  power: 1,
  dist: 5,
}

export const juliaN = parametricVariation(
  'juliaN',
  JuliaNParams,
  JuliaNParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const p1 = P.power
    const p2 = P.dist
    const p3 = trunc(abs(p1) * random())
    const r = length(pos)
    const phi = atan2(pos.y, pos.x)
    const t = (phi + 2 * PI.$ * p3) / p1
    const factor = pow(r, p2 / p1)
    return vec2f(cos(t), sin(t)).mul(factor)
  },
)
