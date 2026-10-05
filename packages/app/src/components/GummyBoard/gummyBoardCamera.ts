/** Perspective framing shared by the whole court and the close crash view. */
import { mat4 } from 'wgpu-matrix'
import type { GummyOrbit } from '@/components/GummyBear/gummyStudyMath'

export type GummyBoardView = 'board' | 'close'
export function initialGummyBoardOrbit(view: GummyBoardView): GummyOrbit {
  return {
    theta: view === 'board' ? 0.38 : 0.24,
    phi: view === 'board' ? 0.72 : 1.08,
    zoom: 1,
  }
}

export function gummyBoardCameraRadius(
  orbit: GummyOrbit,
  aspect: number,
  mode: GummyBoardView,
) {
  const fittedAspect = Math.max(0.25, aspect)
  const target = mode === 'board' ? [0, 0.8, 0] : [-0.2, 2.1, 0.8]
  const bounds =
    mode === 'board'
      ? { min: [-6.7, -0.3, -6.7], max: [6.7, 3.4, 6.7] }
      : { min: [-3.4, 0, -0.3], max: [2.5, 5.8, 1.9] }
  const sp = Math.sin(orbit.phi),
    cp = Math.cos(orbit.phi)
  const st = Math.sin(orbit.theta),
    ct = Math.cos(orbit.theta)
  const tangent = Math.tan(Math.PI / 8) * 0.9
  let radius = 0
  for (const x of [bounds.min[0]!, bounds.max[0]!])
    for (const y of [bounds.min[1]!, bounds.max[1]!])
      for (const z of [bounds.min[2]!, bounds.max[2]!]) {
        const dx = x - target[0]!,
          dy = y - target[1]!,
          dz = z - target[2]!
        const depth = dx * sp * st + dy * cp + dz * sp * ct
        radius = Math.max(
          radius,
          depth + Math.abs(dx * ct - dz * st) / (tangent * fittedAspect),
          depth + Math.abs(-dx * cp * st + dy * sp - dz * cp * ct) / tangent,
        )
      }
  return radius * orbit.zoom
}

export function gummyBoardCameraMatrices(
  orbit: GummyOrbit,
  aspect: number,
  mode: GummyBoardView,
  viewProjection: Float32Array,
  inverse: Float32Array,
  eye: Float32Array,
  view: Float32Array,
  projection: Float32Array,
) {
  const radius = gummyBoardCameraRadius(orbit, aspect, mode)
  const center = mode === 'board' ? [0, 0.8, 0] : [-0.2, 2.1, 0.8]
  const target = center.map((value, axis) => value + (orbit.pan?.[axis] ?? 0))
  eye[0] = target[0]! + radius * Math.sin(orbit.phi) * Math.sin(orbit.theta)
  eye[1] = target[1]! + radius * Math.cos(orbit.phi)
  eye[2] = target[2]! + radius * Math.sin(orbit.phi) * Math.cos(orbit.theta)
  mat4.lookAt(eye, target, [0, 1, 0], view)
  mat4.perspective(Math.PI / 4, Math.max(0.25, aspect), 0.05, 150, projection)
  mat4.mul(projection, view, viewProjection)
  mat4.inverse(viewProjection, inverse)
}
