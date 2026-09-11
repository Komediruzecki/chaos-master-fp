/**
 * Server-side stub for @/flame/colorInitMode.
 *
 * Functions use 'use gpu' arrow syntax — the typegpu wrapper's extractor
 * converts them to WGSL strings at module init time.
 */

import { tgpu } from 'typegpu'
import { vec2f } from 'typegpu/data'

const colorInitModeFn = tgpu.fn([vec2f], vec2f)

export const colorInitModeZero = colorInitModeFn((_pos) => {
  'use gpu'
  return vec2f(0)
})

export const colorInitModePosition = colorInitModeFn((pos) => {
  'use gpu'
  return vec2f(pos)
})

export const colorInitModeToImplFn = {
  colorInitZero: colorInitModeZero,
  colorInitPosition: colorInitModePosition,
}

export type ColorInitMode = keyof typeof colorInitModeToImplFn
