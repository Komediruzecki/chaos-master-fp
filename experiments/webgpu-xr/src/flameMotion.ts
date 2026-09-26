// Coherent musical folds: every displayed position comes from the same rest point.
import { d, std } from 'typegpu'

export const deformFlamePoint = (
  point: d.v4f,
  bands: d.v4f,
  phase: number,
  rotation: number,
) => {
  'use gpu'
  const twist = std.sin(point.y * 2.4 + phase * 0.65) * bands.z * 0.65
  const angle = rotation * 0.08 + twist
  const breath = 1 + bands.y * 0.16
  const fold = 1 + std.sin(point.y * 2.5 + phase * 0.55) * bands.z * 0.12
  const ripple =
    std.sin(point.x * 3 + point.z * 2 + phase * 0.9) * bands.w * 0.065
  const lift = std.sin(point.x * 2 + phase * 0.55) * bands.z * 0.1
  const s = std.sin(angle)
  const c = std.cos(angle)
  return d
    .vec3f(
      (point.x * c + point.z * s) * fold,
      point.y * (1 - bands.y * 0.08) + ripple + lift,
      (-point.x * s + point.z * c) * fold,
    )
    .mul(0.7 * breath)
    .add(d.vec3f(0, 1.6, -2.5))
}
