import { vec2f } from 'typegpu/data'
import { atan2, log, sqrt } from 'typegpu/std'
import { simpleVariation } from '../types'

export const arcsech2Var = simpleVariation(
  'arcsech2Var',
  (pos, varInfo) => {
    'use gpu'
    const denom = pos.x * pos.x + pos.y * pos.y + 1.0e-10
    const z_re = pos.x / denom
    const z_im = -pos.y / denom

    const mag2 = sqrt((z_re - 1.0) * (z_re - 1.0) + z_im * z_im)
    const r2 = sqrt((mag2 + (z_re - 1.0)) * 0.5)
    let i2 = sqrt((mag2 - (z_re - 1.0)) * 0.5)
    if (z_im < 0.0) i2 = -i2

    const mag3 = sqrt((z_re + 1.0) * (z_re + 1.0) + z_im * z_im)
    const r3 = sqrt((mag3 + (z_re + 1.0)) * 0.5)
    let i3 = sqrt((mag3 - (z_re + 1.0)) * 0.5)
    if (z_im < 0.0) i3 = -i3

    const res_re = r3 + r2
    const res_im = i3 + i2

    const r_final = sqrt(res_re * res_re + res_im * res_im)
    const log_re = log(r_final)
    const log_im = atan2(res_im, res_re)

    const w = varInfo.weight
    let outX = 0.0
    let outY = log_im * w

    if (log_im < 0.0) {
      outX = log_re * w
      outY += 1.0 * w
    } else {
      outX = -log_re * w
      outY -= 1.0 * w
    }

    return vec2f(outX, outY)
  },
  'general',
)
