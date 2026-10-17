// GPU and CPU reference presentation transforms for retained world specimens.
import { d, std, tgpu } from 'typegpu'
import { SAMPLE_STEPS } from '../bench/recipes'

/**
 * Style 0 is the raw bench; Glasswake also preserves the accepted Aureole.
 * Tideweave bends the existing Thicket into five fronds around an ovoid.
 * This is an authored deformation, not a different fractal equation. Each
 * retained 32-point chain stays on one frond; no duplication or resampling.
 */
export const worldPoint = tgpu.fn(
  [d.vec3f, d.u32, d.u32],
  d.vec3f,
)((point, index, style) => {
  'use gpu'
  if (style !== 2) return d.vec3f(point)
  const frond = d.u32(index / d.u32(SAMPLE_STEPS)) % d.u32(5)
  const t = std.clamp((point.y + 1) * 0.5, 0, 1)
  const bow = std.sin(t * Math.PI)
  const angle = d.f32(frond) * ((Math.PI * 2) / 5) + (t - 0.5) * 0.65
  const radius = 0.055 + bow * (0.78 + point.z * 0.32)
  const leaf = point.x * bow * 0.9
  const c = std.cos(angle)
  const s = std.sin(angle)
  return d.vec3f(
    radius * c - leaf * s,
    point.y * 1.02 + point.z * bow * 0.1,
    radius * s + leaf * c,
  )
})
