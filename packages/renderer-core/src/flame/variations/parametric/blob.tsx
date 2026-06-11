import { f32, struct, vec2f } from 'typegpu/data'
import { atan2, cos, length, sin } from 'typegpu/std'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type BlobParams = Infer<typeof BlobParams>
const BlobParams = struct({
  high: f32,
  low: f32,
  waves: f32,
})

const BlobParamsDefaults: BlobParams = {
  high: 2,
  low: 1,
  waves: 1,
}

export const blob = parametricVariation(
  'blob',
  BlobParams,
  BlobParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const p1 = P.high
    const p2 = P.low
    const p3 = P.waves
    const r = length(pos)
    const theta = atan2(pos.y, pos.x)
    const sinWavesTheta = sin(p3 * theta)
    const sinFactor = (p1 - p2) / 2
    const blobFact = r * (p2 + sinFactor * (sinWavesTheta + 1))
    return vec2f(cos(theta), sin(theta)).mul(blobFact)
  },
)
