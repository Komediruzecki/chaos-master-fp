import { f32, struct, vec2f } from 'typegpu/data'
import { atan2, cos, pow, select, sin } from 'typegpu/std'
import { RangeEditor } from '@/components/Sliders/ParametricEditors/RangeEditor'
import { editorProps } from '@/components/Sliders/ParametricEditors/types'
import { parametricVariation } from '../types'
import type { Infer } from 'typegpu/data'
import type { EditorFor } from '@/components/Sliders/ParametricEditors/types'

const Murl2VarParams = struct({
  c: f32,
  power: f32,
})
type Murl2VarParams = Infer<typeof Murl2VarParams>
const Murl2VarParamsDefaults: Murl2VarParams = {
  c: 0.0,
  power: 2.0,
}
const Murl2VarParamsEditor: EditorFor<Murl2VarParams> = (props) => (
  <>
    <RangeEditor
      {...editorProps(props, 'c', 'C')}
      min={-1}
      max={5}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'power', 'Power')}
      min={-5}
      max={5}
      step={0.01}
    />
  </>
)
export const murl2Var = parametricVariation(
  'murl2Var',
  Murl2VarParams,
  Murl2VarParamsDefaults,
  Murl2VarParamsEditor,
  (pos, varInfo, P) => {
    'use gpu'
    const p2 = P.power / 2.0
    const powerNonZero = P.power !== 0.0
    const vp_zero_power = varInfo.weight * pow(P.c + 1.0, 4.0)
    const vp_nonzero_base = varInfo.weight * pow(P.c + 1.0, 2.0 / P.power)
    const vp_nonzero = select(vp_nonzero_base, 0.0, P.c === -1.0)
    const vp = select(vp_zero_power, vp_nonzero, powerNonZero)
    const a = atan2(pos.y, pos.x) * P.power
    const sina = sin(a)
    const cosa = cos(a)
    const r = P.c * pow(pos.x * pos.x + pos.y * pos.y, p2)
    const re = r * cosa + 1.0
    const im = r * sina
    const r2 = re * re + im * im
    const invp = select(100000000000.0, 1.0 / P.power, powerNonZero)
    const r3 = pow(r2, invp)
    const a2 = atan2(im, re) * invp // (a * invp)
    const newX = vp * r3 * cos(a2) - varInfo.weight
    const newY = vp * r3 * sin(a2)
    return vec2f(newX, newY)
  },
  'general',
)
