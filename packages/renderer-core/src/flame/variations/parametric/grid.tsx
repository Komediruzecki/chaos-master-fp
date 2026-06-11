import { f32, struct, vec2f } from 'typegpu/data'
import { abs, round, select } from 'typegpu/std'
import { random } from '@/shaders/random'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type GridParams = Infer<typeof GridParams>
const GridParams = struct({
  divisions: f32,
  size: f32,
  jitterNearIntersectionsDistance: f32,
})

const GridParamsDefaults: GridParams = {
  divisions: 10.0,
  size: 1.0,
  jitterNearIntersectionsDistance: 0.002,
}

export const grid = parametricVariation(
  'grid',
  GridParams,
  GridParamsDefaults,
  undefined,
  (_pos, _varInfo, P) => {
    'use gpu'
    const D = P.jitterNearIntersectionsDistance
    const divs = select(P.divisions, 1, random() > 0.8)
    const pos = vec2f(random(), random()).mul(2).sub(1).mul(P.size)
    const jitter = vec2f(random(), random())
      .mul(2)
      .sub(1)
      .mul(2 * D)
    const rounded = round(pos.mul(divs)).div(divs)
    const diff = abs(pos.sub(rounded))
    const jittered = select(pos, pos.add(jitter), diff < vec2f(D))
    return select(
      vec2f(rounded.x, jittered.y),
      vec2f(jittered.x, rounded.y),
      random() > 0.5,
    )
  },
)
