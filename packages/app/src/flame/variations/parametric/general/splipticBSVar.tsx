import { f32, struct, vec2f } from 'typegpu/data'
import { atan2, log, max, select, sqrt } from 'typegpu/std'
import { RangeEditor } from '@/components/Sliders/ParametricEditors/RangeEditor'
import { editorProps } from '@/components/Sliders/ParametricEditors/types'
import { EPS, PI } from '@/flame/constants'
import { random } from '@/shaders/random'
import { parametricVariation } from '../types'
import type { Infer } from 'typegpu/data'
import type { EditorFor } from '@/components/Sliders/ParametricEditors/types'

const SplipticBSVarParams = struct({
  x: f32,
  y: f32,
})

type SplipticBSVarParams = Infer<typeof SplipticBSVarParams>

const SplipticBSVarParamsDefaults: SplipticBSVarParams = {
  x: 0.05,
  y: 0.05,
}

const SplipticBSVarParamsEditor: EditorFor<SplipticBSVarParams> = (props) => (
  <>
    <RangeEditor
      {...editorProps(props, 'x', 'X', props.dataParameterPath)}
      min={-1.0}
      max={1.0}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'y', 'Y', props.dataParameterPath)}
      min={-1.0}
      max={1.0}
      step={0.01}
    />
  </>
)

export const splipticBSVar = parametricVariation(
  'splipticBSVar',
  SplipticBSVarParams,
  SplipticBSVarParamsDefaults,
  SplipticBSVarParamsEditor,
  (pos, _varInfo, P) => {
    'use gpu'

    const paramX = P.x
    const paramY = P.y
    const tmp = paramY * paramY + paramX * paramX + 1.0
    const x2 = 2.0 * paramX
    const xmax = 0.5 * (sqrt(tmp + x2) + sqrt(tmp - x2))
    const a = paramX / xmax
    const b = sqrt(max(1.0 - a * a, 0.0))
    const scale = 2.0 / PI.$

    const termX = atan2(a, b) * scale
    const outX = select(termX - paramX, termX + paramX, pos.x >= 0.0)

    const termY =
      log(max(xmax + sqrt(max(xmax - 1.0, 0.0)), EPS.$)) * scale + paramY
    const outY = select(termY, -termY, random() < 0.5)

    return vec2f(outX, outY)
  },
  'general',
)
