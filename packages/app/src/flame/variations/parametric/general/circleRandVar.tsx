import { f32, i32, struct, u32, vec2f } from 'typegpu/data'
import { floor, select, sqrt } from 'typegpu/std'
import { RangeEditor } from '@/components/Sliders/ParametricEditors/RangeEditor'
import { editorProps } from '@/components/Sliders/ParametricEditors/types'
import { random } from '@/shaders/random'
import { parametricVariation } from '../types'
import type { Infer } from 'typegpu/data'
import type { EditorFor } from '@/components/Sliders/ParametricEditors/types'

const AM = 1.0 / 2147483647.0

const CircleRandVarParams = struct({
  sc: f32,
  dens: f32,
  x: f32,
  y: f32,
  seed: f32,
})

type CircleRandVarParams = Infer<typeof CircleRandVarParams>

const CircleRandVarParamsDefaults: CircleRandVarParams = {
  sc: 1.0,
  dens: 0.5,
  x: 10.0,
  y: 10.0,
  seed: 0.0,
}

const CircleRandVarParamsEditor: EditorFor<CircleRandVarParams> = (props) => (
  <>
    <RangeEditor
      {...editorProps(props, 'sc', 'Sc', props.dataParameterPath)}
      min={0.01}
      max={10.0}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'dens', 'Dens', props.dataParameterPath)}
      min={0.0}
      max={1.0}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'x', 'X', props.dataParameterPath)}
      min={0.1}
      max={50.0}
      step={0.1}
    />
    <RangeEditor
      {...editorProps(props, 'y', 'Y', props.dataParameterPath)}
      min={0.1}
      max={50.0}
      step={0.1}
    />
    <RangeEditor
      {...editorProps(props, 'seed', 'Seed', props.dataParameterPath)}
      min={0.0}
      max={100.0}
      step={1.0}
    />
  </>
)

export const circleRandVar = parametricVariation(
  'circleRandVar',
  CircleRandVarParams,
  CircleRandVarParamsDefaults,
  CircleRandVarParamsEditor,
  (pos, _varInfo, P) => {
    'use gpu'
    const X = P.x * (1.0 - 2.0 * random())
    const Y = P.y * (1.0 - 2.0 * random())
    const M = floor((0.5 * X) / P.sc)
    const N = floor((0.5 * Y) / P.sc)
    const rX = X - (M * 2.0 + 1.0) * P.sc
    const rY = Y - (N * 2.0 + 1.0) * P.sc
    const U = sqrt(rX * rX + rY * rY)

    const n1 = i32(M + P.seed) + i32(N) * 57
    const n1x = i32(u32(n1) << u32(13)) ^ n1
    const z1 =
      f32((n1x * (n1x * n1x * 15731 + 789221) + 1376312589) & 0x7fffffff) * AM

    const n2 = i32(M + 10.0) + i32(N + 3.0) * 57
    const n2x = i32(u32(n2) << u32(13)) ^ n2
    const V =
      (0.3 +
        0.7 *
          f32((n2x * (n2x * n2x * 15731 + 789221) + 1376312589) & 0x7fffffff) *
          AM) *
      P.sc

    const hit = z1 <= P.dens && U <= V
    const outX = select(X, rX + (M * 2.0 + 1.0) * P.sc, hit)
    const outY = select(Y, rY + (N * 2.0 + 1.0) * P.sc, hit)

    return vec2f(outX, outY)
  },
  'general',
)
