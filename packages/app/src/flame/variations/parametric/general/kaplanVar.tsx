import { f32, struct, vec2f } from 'typegpu/data'
import { atan2, cos, floor, log, pow, select, sign, sin } from 'typegpu/std'
import { RangeEditor } from '@/components/Sliders/ParametricEditors/RangeEditor'
import { editorProps } from '@/components/Sliders/ParametricEditors/types'
import { random } from '@/shaders/random'
import { parametricVariation } from '../types'
import type { Infer } from 'typegpu/data'
import type { EditorFor } from '@/components/Sliders/ParametricEditors/types'

const KaplanVarParams = struct({
  seed: f32,
  n: f32,
  time: f32,
  invert: f32,
})
type KaplanVarParams = Infer<typeof KaplanVarParams>
const KaplanVarParamsDefaults: KaplanVarParams = {
  seed: 1000.0,
  n: 10.0,
  time: 1.0,
  invert: 0.0,
}
const KaplanVarParamsEditor: EditorFor<KaplanVarParams> = (props) => (
  <>
    <RangeEditor {...editorProps(props, 'n', 'N')} min={1} max={50} step={1} />
    <RangeEditor
      {...editorProps(props, 'time', 'Time')}
      min={0}
      max={10}
      step={0.01}
    />
    <RangeEditor
      {...editorProps(props, 'invert', 'Invert')}
      min={0}
      max={1}
      step={1}
    />
  </>
)
export const kaplanVar = parametricVariation(
  'kaplanVar',
  KaplanVarParams,
  KaplanVarParamsDefaults,
  KaplanVarParamsEditor,
  (pos, varInfo, P) => {
    'use gpu'
    const rx = floor(P.n * random())
    const ry = floor(P.n * random())
    const zoom = floor(P.time)
    const xv = zoom * (rx - floor(P.n / 2.0))
    const yv = zoom * (ry - floor(P.n / 2.0))
    const r0 = atan2(xv, yv)
    const c = cos(r0)
    const s = sin(r0)
    const uv_x = xv * c - yv * s
    const uv_y = xv * s + yv * c
    const value = uv_x * uv_x + uv_y * uv_y
    const log2 = 0.69314718
    const exponent = floor(log(value) / log2)
    const mantissa = value * pow(2.0, -exponent) - 1.0
    const p16 = 65536.0
    const r = mantissa - floor(mantissa * p16 + 0.5) / p16
    const color = sign(r)
    let keep = false
    if (P.invert < 0.5) {
      keep = color > 0.0
    } else {
      keep = color <= 0.0
    }
    const newX = select(0.0, pos.x, keep)
    const newY = select(0.0, pos.y, keep)
    return vec2f(varInfo.weight * newX, varInfo.weight * newY)
  },
  'general',
)
