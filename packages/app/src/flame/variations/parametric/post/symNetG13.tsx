import { f32, struct, vec2f } from 'typegpu/data'
import { floor, sqrt } from 'typegpu/std'
import { RangeEditor } from '@/components/Sliders/ParametricEditors/RangeEditor'
import { editorProps } from '@/components/Sliders/ParametricEditors/types'
import { random } from '@/shaders/random'
import { parametricVariation } from '../types'
import type { Infer } from 'typegpu/data'
import type { EditorFor } from '@/components/Sliders/ParametricEditors/types'

const SymNetG13Params = struct({
  radius: f32,
  stepx: f32,
  stepy: f32,
})
type SymNetG13Params = Infer<typeof SymNetG13Params>
const SymNetG13ParamsDefaults: SymNetG13Params = {
  radius: 0.0,
  stepx: 0.0,
  stepy: 0.0,
}
const SymNetG13ParamsEditor: EditorFor<SymNetG13Params> = (props) => (
  <>
    <RangeEditor {...editorProps(props, 'radius', 'Radius')} min={-5} max={5} />
    <RangeEditor {...editorProps(props, 'stepx', 'Step X')} min={-5} max={5} />
    <RangeEditor {...editorProps(props, 'stepy', 'Step Y')} min={-5} max={5} />
  </>
)

export const symNetG13 = parametricVariation(
  'symNetG13',
  SymNetG13Params,
  SymNetG13ParamsDefaults,
  SymNetG13ParamsEditor,
  (pos, _varInfo, P) => {
    'use gpu'
    const sp = sqrt(P.radius * P.radius * 0.5)
    const px = pos.x + sp
    const py = pos.y + sp
    const hx = P.stepx * 0.5
    const hy = P.stepy * 0.5
    const band = floor(random() * 6.0)
    if (band < 3.0) {
      if (band < 1.0) {
        return vec2f(px - hx, -py - hy)
      }
      if (band < 2.0) {
        return vec2f(-0.5 * px - 0.866 * py - hx, -0.866 * px + 0.5 * py - hy)
      }
      return vec2f(-0.5 * px + 0.866 * py - hx, 0.866 * px + 0.5 * py - hy)
    }
    if (band < 4.0) {
      return vec2f(px + hx, -py + hy)
    }
    if (band < 5.0) {
      return vec2f(-0.5 * px - 0.866 * py + hx, -0.866 * px + 0.5 * py + hy)
    }
    return vec2f(-0.5 * px + 0.866 * py + hx, 0.866 * px + 0.5 * py + hy)
  },
  'symmetry',
)
