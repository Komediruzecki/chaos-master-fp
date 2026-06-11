import { f32, struct, vec2f } from 'typegpu/data'
import { sin } from 'typegpu/std'
import { PI } from '@/flame/constants'
import { random } from '@/shaders/random'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

const LissajousVarParams = struct({
  tmin: f32,
  tmax: f32,
  a: f32,
  b: f32,
  c: f32,
  d: f32,
  e: f32,
})

type LissajousVarParams = Infer<typeof LissajousVarParams>

const LissajousVarParamsDefaults: LissajousVarParams = {
  tmin: -PI.$,
  tmax: PI.$,
  a: 3.0,
  b: 2.0,
  c: 0.0,
  d: 0.0,
  e: 0.0,
}

export const lissajousVar = parametricVariation(
  'lissajousVar',
  LissajousVarParams,
  LissajousVarParamsDefaults,
  undefined,
  (_pos, _varInfo, P) => {
    'use gpu'

    const t = (P.tmax - P.tmin) * random() + P.tmin
    const y = random() - 0.5
    const newPos = vec2f(sin(P.a * t + P.d), sin(P.b * t))
    const k = P.c * t + P.e * y
    return vec2f(newPos.add(k))
  },
)
