import { f32, i32, struct, vec2f } from 'typegpu/data'
import { parametricVariation } from './types'
import type { Infer } from 'typegpu/data'

type InvEllipseParams = Infer<typeof InvEllipseParams>
const InvEllipseParams = struct({
  a: f32,
  b: f32,
  h: f32,
  k: f32,
  restricted: i32,
})

const InvEllipseParamsDefaults: InvEllipseParams = {
  a: 0.65,
  b: 0.5,
  h: 0,
  k: 0,
  restricted: 1,
}

export const invEllipse = parametricVariation(
  'invEllipse',
  InvEllipseParams,
  InvEllipseParamsDefaults,
  undefined,
  (pos, _varInfo, P) => {
    'use gpu'
    const dx = pos.x - P.h
    const dy = pos.y - P.k
    const dx2 = dx * dx
    const dy2 = dy * dy
    const a2 = P.a * P.a
    const b2 = P.b * P.b
    const denom = dx2 / a2 + dy2 / b2

    // restricted/unrestricted elipse handling
    if (P.restricted === 1) {
      if (denom < 1) {
        return vec2f(pos)
      }
    }
    const u = P.h + dx / denom
    const v = P.k + dy / denom
    return vec2f(u, v)
  },
)
