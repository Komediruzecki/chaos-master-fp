/** Fit full-height art pieces and choose their actual sampled bounds rather than the floor behind them. */
import { mat4 } from 'wgpu-matrix'
import type { BoardCamera } from '../PawnBoard/pawnBoardMath'
import type { CollectionCloud } from './collectionCloudWorker'
import type { CollectionInstance, CollectionView, } from './collectionStageLayout'

export function collectionCameraMatrices(
  mode: CollectionView,
  camera: BoardCamera,
  aspect: number,
  viewProjection: Float32Array,
  inverse: Float32Array,
  eye: Float32Array,
  view: Float32Array,
  projection: Float32Array,
  comparisonPair = false,
) {
  const targetY = mode === 'board' ? 0.7 : 1.25
  const extentX =
    mode === 'board'
      ? 6.63
      : mode === 'lineup'
        ? comparisonPair
          ? 6.45
          : 5.5
        : comparisonPair
          ? 1.7
          : 0.85
  const extentZ = mode === 'board' ? 6.63 : 0.85
  const minY = mode === 'board' ? -0.455 : 0
  const fittedAspect = Math.max(0.25, aspect)
  const st = Math.sin(camera.theta),
    ct = Math.cos(camera.theta)
  const sp = Math.sin(camera.phi),
    cp = Math.cos(camera.phi)
  const tangent = Math.tan(Math.PI / 8) * 0.9
  let fittedRadius = 0
  for (const x of [-extentX, extentX])
    for (const y of [minY, 2.6])
      for (const z of [-extentZ, extentZ]) {
        const relativeY = y - targetY
        const depth = x * sp * st + relativeY * cp + z * sp * ct
        fittedRadius = Math.max(
          fittedRadius,
          depth + Math.abs(x * ct - z * st) / (tangent * fittedAspect),
          depth +
            Math.abs(-x * cp * st + relativeY * sp - z * cp * ct) / tangent,
        )
      }
  const radius = fittedRadius * camera.zoom
  eye[0] = radius * sp * st
  eye[1] = targetY + radius * cp
  eye[2] = radius * sp * ct
  mat4.lookAt(eye, [0, targetY, 0], [0, 1, 0], view)
  mat4.perspective(Math.PI / 4, fittedAspect, 0.05, 250, projection)
  mat4.mul(projection, view, viewProjection)
  mat4.inverse(viewProjection, inverse)
}

export function pickCollectionInstance(
  x: number,
  y: number,
  inverse: Float32Array,
  instances: readonly CollectionInstance[],
  clouds: readonly CollectionCloud[],
): CollectionInstance | undefined {
  const unproject = (z: number) => {
    const w =
      inverse[3]! * x + inverse[7]! * y + inverse[11]! * z + inverse[15]!
    return [
      (inverse[0]! * x + inverse[4]! * y + inverse[8]! * z + inverse[12]!) / w,
      (inverse[1]! * x + inverse[5]! * y + inverse[9]! * z + inverse[13]!) / w,
      (inverse[2]! * x + inverse[6]! * y + inverse[10]! * z + inverse[14]!) / w,
    ]
  }
  const origin = unproject(0),
    far = unproject(1)
  const direction = far.map((value, axis) => value - origin[axis]!)
  let closest = Infinity,
    result: CollectionInstance | undefined
  for (const instance of instances) {
    const cloud = clouds.find((item) => item.key === instance.cloudKey)
    if (!cloud) continue
    let enter = 0,
      leave = Infinity
    const scale = instance.scale ?? 1
    for (let axis = 0; axis < 3; axis++) {
      const min = cloud.bounds.min[axis]! * scale + instance.position[axis]!
      const max = cloud.bounds.max[axis]! * scale + instance.position[axis]!
      if (Math.abs(direction[axis]!) < 1e-9) {
        if (origin[axis]! < min || origin[axis]! > max) {
          leave = -1
          break
        }
        continue
      }
      const a = (min - origin[axis]!) / direction[axis]!
      const b = (max - origin[axis]!) / direction[axis]!
      enter = Math.max(enter, Math.min(a, b))
      leave = Math.min(leave, Math.max(a, b))
    }
    if (leave >= enter && enter < closest) {
      closest = enter
      result = instance
    }
  }
  return result
}

export type CollectionComparisonLabel = {
  text: string
  x: number
  y: number
}

/** Anchor each label above its projected specimen, including after orbiting behind the pair. */
export function collectionComparisonLabels(
  viewProjection: Float32Array,
  instances: readonly CollectionInstance[],
  clouds: readonly CollectionCloud[],
): CollectionComparisonLabel[] {
  return instances.flatMap((piece) => {
    const bounds = clouds.find((cloud) => cloud.key === piece.cloudKey)?.bounds
    if (!bounds) return []
    let left = Infinity,
      right = -Infinity,
      top = Infinity
    const scale = piece.scale ?? 1
    for (const bx of [bounds.min[0] - 0.12, bounds.max[0] + 0.12])
      for (const by of [bounds.min[1], bounds.max[1] + 0.18])
        for (const bz of [bounds.min[2] - 0.12, bounds.max[2] + 0.12]) {
          const x = bx * scale + piece.position[0]
          const y = by * scale + piece.position[1]
          const z = bz * scale + piece.position[2]
          const w =
            x * viewProjection[3]! +
            y * viewProjection[7]! +
            z * viewProjection[11]! +
            viewProjection[15]!
          if (w <= 0) return []
          const sx =
            (x * viewProjection[0]! +
              y * viewProjection[4]! +
              z * viewProjection[8]! +
              viewProjection[12]!) /
            w
          const sy =
            (x * viewProjection[1]! +
              y * viewProjection[5]! +
              z * viewProjection[9]! +
              viewProjection[13]!) /
            w
          left = Math.min(left, sx)
          right = Math.max(right, sx)
          top = Math.min(top, (1 - sy) / 2)
        }
    const x = (1 + (left + right) / 2) / 2
    if (x < 0.04 || x > 0.96 || top < 0.04 || top > 0.96) return []
    return [
      { text: piece.glassKey ? 'Inside glass' : 'Pure fractal', x, y: top },
    ]
  })
}
