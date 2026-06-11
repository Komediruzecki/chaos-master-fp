import { perlin2d } from '@typegpu/noise'
import { f32, i32, struct, vec2f } from 'typegpu/data'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

const PerlinNoiseVarParams = struct({
  octaves: i32,
  persistance: f32,
  lacunarity: f32,
})

type PerlinNoiseVarParams = Infer<typeof PerlinNoiseVarParams>

const PerlinNoiseVarParamsDefaults: PerlinNoiseVarParams = {
  octaves: 8,
  persistance: 0.4,
  lacunarity: 2.4,
}

export const perlinNoiseVar = parametricVariation(
  'perlinNoiseVar',
  PerlinNoiseVarParams,
  PerlinNoiseVarParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    let total = f32(0)
    let maxValue = f32(0)
    let freq = f32(1)
    let amplitude = f32(1)
    const lacunarity = P.lacunarity
    const persistence = P.persistance

    for (let i = 0; i < P.octaves; i++) {
      total += perlin2d.sample(pos.mul(freq)) * amplitude

      maxValue += amplitude

      freq *= lacunarity
      amplitude *= persistence
    }

    return vec2f(pos).add(total / maxValue)
  },
)
