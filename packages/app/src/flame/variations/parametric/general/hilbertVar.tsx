import { f32, struct, vec2f } from 'typegpu/data'
import { abs, floor, fract } from 'typegpu/std'
import { RangeEditor } from '@/components/Sliders/ParametricEditors/RangeEditor'
import { editorProps } from '@/components/Sliders/ParametricEditors/types'
import { parametricVariation } from '../types'
import type { Infer } from 'typegpu/data'
import type { EditorFor } from '@/components/Sliders/ParametricEditors/types'

type HilbertVarParams = Infer<typeof HilbertVarParams>
const HilbertVarParams = struct({
  iterations: f32,
})

const HilbertVarParamsDefaults: HilbertVarParams = {
  iterations: 5,
}

const HilbertVarParamsEditor: EditorFor<HilbertVarParams> = (props) => (
  <>
    <RangeEditor
      {...editorProps(props, 'iterations', 'Iterations')}
      min={1}
      max={10}
      step={1}
    />
  </>
)

export const hilbertVar = parametricVariation(
  'hilbertVar',
  HilbertVarParams,
  HilbertVarParamsDefaults,
  HilbertVarParamsEditor,
  (pos, _varInfo, _P) => {
    'use gpu'
    const x = abs(pos.x) * 0.5 + 0.25
    const y = abs(pos.y) * 0.5 + 0.25
    const qx = floor(x * 2.0)
    const qy = floor(y * 2.0)
    const fx = fract(x * 2.0)
    const fy = fract(y * 2.0)
    const flipx = 1.0 - fx
    const flipy = 1.0 - fy
    const nx = qx > 0.0 ? (qy > 0.0 ? fx : flipy) : qy > 0.0 ? fy : flipx
    const ny = qx > 0.0 ? (qy > 0.0 ? fy : fx) : qy > 0.0 ? flipx : flipy
    return vec2f(nx * 2.0 - 1.0, ny * 2.0 - 1.0)
  },
  'general',
)
