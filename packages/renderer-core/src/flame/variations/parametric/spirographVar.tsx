import { f32, struct, vec2f } from 'typegpu/data'
import { cos, sin } from 'typegpu/std'
import { random } from '@/shaders/random'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

const SpirographVarParams = struct({
  a: f32,
  b: f32,
  d: f32,
  tmin: f32,
  tmax: f32,
  ymin: f32,
  ymax: f32,
  c1: f32,
  c2: f32,
})

type SpirographVarParams = Infer<typeof SpirographVarParams>

const SpirographVarParamsDefaults: SpirographVarParams = {
  a: 3.0,
  b: 2.0,
  d: 0.0,
  tmin: -1.0,
  tmax: 1.0,
  ymin: -1.0,
  ymax: 1.0,
  c1: 0.0,
  c2: 0.0,
}

export const spirographVar = parametricVariation(
  'spirographVar',
  SpirographVarParams,
  SpirographVarParamsDefaults,
  undefined,
  (_pos, _varInfo, P) => {
    'use gpu'

    const t = (P.tmax - P.tmin) * random() + P.tmin
    const y = (P.ymax - P.ymin) * random() + P.ymin

    const x1 = (P.a + P.b) * cos(t) - P.c1 * cos(((P.a + P.b) / P.b) * t)
    const y1 = (P.a + P.b) * sin(t) - P.c2 * sin(((P.a + P.b) / P.b) * t)

    const newX = x1 + P.d * cos(t) + y
    const newY = y1 + P.d * sin(t) + y

    return vec2f(newX, newY)
  },
)
