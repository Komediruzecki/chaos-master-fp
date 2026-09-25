// Scene-authored flame identity and state, also available to the IWSDK editor.
import { createComponent, defineComponents, Types } from '@iwsdk/core'

export const Flame = createComponent('LumenFlame', {
  selected: { type: Types.Boolean, default: false },
})
export default defineComponents([Flame])
