import { f32, struct, vec2f } from 'typegpu/data'
import { RangeEditor } from '@/components/Sliders/ParametricEditors/RangeEditor'
import { editorProps } from '@/components/Sliders/ParametricEditors/types'
import { parametricVariation } from '../types'
import type { Infer } from 'typegpu/data'
import type { EditorFor } from '@/components/Sliders/ParametricEditors/types'

const Q_odeVarParams = struct({
  q_ode01: f32,
  q_ode02: f32,
  q_ode03: f32,
  q_ode04: f32,
  q_ode05: f32,
  q_ode06: f32,
  q_ode07: f32,
  q_ode08: f32,
  q_ode09: f32,
  q_ode10: f32,
  q_ode11: f32,
  q_ode12: f32,
})
type Q_odeVarParams = Infer<typeof Q_odeVarParams>
const Q_odeVarParamsDefaults: Q_odeVarParams = {
  q_ode01: 0.0,
  q_ode02: 0.0,
  q_ode03: 0.0,
  q_ode04: 0.0,
  q_ode05: 0.0,
  q_ode06: 0.0,
  q_ode07: 0.0,
  q_ode08: 0.0,
  q_ode09: 0.0,
  q_ode10: 0.0,
  q_ode11: 0.0,
  q_ode12: 0.0,
}
const Q_odeVarParamsEditor: EditorFor<Q_odeVarParams> = (props) => (
  <>
    <RangeEditor
      {...editorProps(props, 'q_ode01', ' Q 01 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode02', ' Q 02 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode03', ' Q 03 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode04', ' Q 04 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode05', ' Q 05 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode06', ' Q 06 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode07', ' Q 07 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode08', ' Q 08 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode09', ' Q 09 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode10', ' Q 10 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode11', ' Q 11 ')}
      min={-1}
      max={1}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'q_ode12', ' Q 12 ')}
      min={-1}
      max={1}
      step={0.01}
    />
  </>
)
export const q_odeVar = parametricVariation(
  'q_odeVar',
  Q_odeVarParams,
  Q_odeVarParamsDefaults,
  Q_odeVarParamsEditor,
  (pos, varInfo, P) => {
    'use gpu'
    const x = pos.x
    const y = pos.y
    const x2 = x * x
    const y2 = y * y
    const xy = x * y
    const w = varInfo.weight
    const newX =
      P.q_ode01 +
      w * P.q_ode02 * x +
      P.q_ode03 * x2 +
      P.q_ode04 * x2 * x +
      w * P.q_ode05 * y +
      P.q_ode06 * y2 +
      P.q_ode07 * y2 * y +
      P.q_ode08 * xy +
      P.q_ode09 * x2 * y +
      P.q_ode10 * x * y2
    const newY =
      P.q_ode01 +
      w * P.q_ode12 * x +
      P.q_ode03 * x2 +
      P.q_ode04 * x2 * x +
      w * P.q_ode11 * y +
      P.q_ode06 * y2 +
      P.q_ode07 * y2 * y +
      P.q_ode08 * xy +
      P.q_ode09 * x2 * y +
      P.q_ode10 * x * y2
    return vec2f(newX, newY)
  },
  'general',
)
