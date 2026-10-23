/** Shared Y-up board coordinates, orbit framing and perspective ray picking. */
import { mat4 } from 'wgpu-matrix'
import type { Piece, Square } from '@/flame/chess/pawnGame'

export const BOARD_TILE_SIZE = 1.6
export const BOARD_TOP = 0.06
export const PAWN_FLOOR_OFFSET = 0.03
export const MOVE_SECONDS = 0.65
export const CAPTURE_SECONDS = 2.1

export type BoardCamera = { theta: number; phi: number; zoom: number }
export const DEFAULT_BOARD_CAMERA: Readonly<BoardCamera> = Object.freeze({
  theta: 0.38,
  phi: 0.73,
  zoom: 1,
})
export const DEFAULT_INSPECTION_CAMERA: Readonly<BoardCamera> = Object.freeze({
  theta: 0.22,
  phi: 1.27,
  zoom: 1,
})

/** Close orbit around one full-height pawn, fitted for portrait screens too. */
export function pawnInspectionCameraMatrices(
  camera: BoardCamera,
  aspect: number,
  viewProjection: Float32Array,
  inverse: Float32Array,
  eye: Float32Array,
  view: Float32Array,
  projection: Float32Array,
) {
  const fittedAspect = Math.max(0.25, aspect)
  const radius = 3.45 * Math.max(1, 0.8 / fittedAspect) * camera.zoom
  eye[0] = radius * Math.sin(camera.phi) * Math.sin(camera.theta)
  eye[1] = 0.99 + radius * Math.cos(camera.phi)
  eye[2] = radius * Math.sin(camera.phi) * Math.cos(camera.theta)
  mat4.lookAt(eye, [0, 0.99, 0], [0, 1, 0], view)
  mat4.perspective(Math.PI / 4, fittedAspect, 0.05, 100, projection)
  mat4.mul(projection, view, viewProjection)
  mat4.inverse(viewProjection, inverse)
}

export function squareWorld(square: Square): [number, number, number] {
  return [
    (square.file - 3.5) * BOARD_TILE_SIZE,
    BOARD_TOP + PAWN_FLOOR_OFFSET,
    (3.5 - square.rank) * BOARD_TILE_SIZE,
  ]
}

export function boardCameraMatrices(
  camera: BoardCamera,
  aspect: number,
  viewProjection: Float32Array,
  inverse: Float32Array,
  eye: Float32Array,
  view: Float32Array,
  projection: Float32Array,
) {
  const fittedAspect = Math.max(0.25, aspect)
  const st = Math.sin(camera.theta),
    ct = Math.cos(camera.theta)
  const sp = Math.sin(camera.phi),
    cp = Math.cos(camera.phi)
  // Fit the board slab and possible pawn crowns to 92% of both projection
  // axes, including perspective depth; portrait views use the same bound.
  let fittedRadius = 0
  const tangent = Math.tan(Math.PI / 8) * 0.92
  for (const x of [-6.63, 6.63])
    for (const y of [-0.455, 1.95])
      for (const z of [-6.63, 6.63]) {
        const relativeY = y - 0.45
        const depth = x * sp * st + relativeY * cp + z * sp * ct
        const horizontal = x * ct - z * st
        const vertical = -x * cp * st + relativeY * sp - z * cp * ct
        fittedRadius = Math.max(
          fittedRadius,
          depth + Math.abs(horizontal) / (tangent * fittedAspect),
          depth + Math.abs(vertical) / tangent,
        )
      }
  const radius = fittedRadius * camera.zoom
  eye[0] = radius * Math.sin(camera.phi) * Math.sin(camera.theta)
  eye[1] = 0.45 + radius * Math.cos(camera.phi)
  eye[2] = radius * Math.sin(camera.phi) * Math.cos(camera.theta)
  mat4.lookAt(eye, [0, 0.45, 0], [0, 1, 0], view)
  mat4.perspective(Math.PI / 4, fittedAspect, 0.1, 150, projection)
  mat4.mul(projection, view, viewProjection)
  mat4.inverse(viewProjection, inverse)
}

/** NDC x/y, WebGPU z[0,1]; reject rays pointing away or outside the eight ranks. */
function pickRay(x: number, y: number, inverse: ArrayLike<number>) {
  const unproject = (z: number) => {
    const w =
      inverse[3]! * x + inverse[7]! * y + inverse[11]! * z + inverse[15]!
    return [
      (inverse[0]! * x + inverse[4]! * y + inverse[8]! * z + inverse[12]!) / w,
      (inverse[1]! * x + inverse[5]! * y + inverse[9]! * z + inverse[13]!) / w,
      (inverse[2]! * x + inverse[6]! * y + inverse[10]! * z + inverse[14]!) / w,
    ]
  }
  const near = unproject(0)
  const far = unproject(1)
  return { near, direction: far.map((value, axis) => value - near[axis]!) }
}

/** Pick the closest visible head/body/base sphere before the plane behind it. */
export function pickPawnSquare(
  x: number,
  y: number,
  inverse: ArrayLike<number>,
  pieces: readonly Piece[],
): Square | undefined {
  const { near, direction } = pickRay(x, y, inverse)
  const a = direction.reduce((sum, value) => sum + value * value, 0)
  if (!Number.isFinite(a) || a === 0) return undefined
  let closest = Infinity,
    square: Square | undefined
  for (const piece of pieces) {
    const position = squareWorld(piece.square)
    for (const [height, radius] of [
      [1.47, 0.4],
      [0.78, 0.29],
      [0.14, 0.67],
    ]) {
      const delta = [
        near[0]! - position[0],
        near[1]! - position[1] - height!,
        near[2]! - position[2],
      ]
      const b =
        2 *
        direction.reduce((sum, value, axis) => sum + value * delta[axis]!, 0)
      const c =
        delta.reduce((sum, value) => sum + value * value, 0) - radius! * radius!
      const discriminant = b * b - 4 * a * c
      if (discriminant < 0) continue
      const t = (-b - Math.sqrt(discriminant)) / (2 * a)
      if (t >= 0 && t < closest) {
        closest = t
        square = piece.square
      }
    }
  }
  return square
}

export function pickBoardSquare(
  x: number,
  y: number,
  inverse: ArrayLike<number>,
): Square | undefined {
  const { near, direction } = pickRay(x, y, inverse)
  const dy = direction[1]!
  if (!Number.isFinite(dy) || Math.abs(dy) < 1e-8) return undefined
  const t = (BOARD_TOP - near[1]!) / dy
  if (t < 0) return undefined
  const worldX = near[0]! + direction[0]! * t
  const worldZ = near[2]! + direction[2]! * t
  const file = Math.floor(worldX / BOARD_TILE_SIZE + 4)
  const rank = Math.floor(4 - worldZ / BOARD_TILE_SIZE)
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return undefined
  return { file, rank }
}

export function moveProgress(age: number): number {
  const t = Math.max(0, Math.min(1, age / MOVE_SECONDS))
  return t * t * (3 - 2 * t)
}
