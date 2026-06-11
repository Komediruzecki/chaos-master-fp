import { f32, struct, vec2f, vec3f } from 'typegpu/data'
import { cos, length, sin } from 'typegpu/std'
import { PI } from '@/flame/constants'
import { random } from '@/shaders/random'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

const LineVarParams = struct({
  delta: f32,
  phi: f32,
})

type LineVarParams = Infer<typeof LineVarParams>

const LineVarParamsDefaults: LineVarParams = {
  delta: 0.0,
  phi: 0.0,
}

export const lineVar = parametricVariation(
  'lineVar',
  LineVarParams,
  LineVarParamsDefaults,
  undefined,
  (_pos, _varInfo, P) => {
    'use gpu'

    const uv = vec3f(
      cos(P.delta * PI.$) * cos(P.phi * PI.$),
      sin(P.delta * PI.$) * cos(P.phi * PI.$),
      sin(P.phi * PI.$),
    )

    const r = length(uv)
    const rand = random()
    return vec2f((uv.x / r) * rand, (uv.y / r) * rand)
  },
)
