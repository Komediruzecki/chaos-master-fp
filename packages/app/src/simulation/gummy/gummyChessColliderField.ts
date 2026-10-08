/** Bounded contact-volume bake from the same implicit mould used for visible candy geometry. */
import { createAuthoredPawnField } from './gummyAuthoredPawn'
import { GUMMY_CHESS_MOULDS, gummyChessField, isGummyChessMould, } from './gummyChessMoulds'
import type { GummyAuthoredPawn } from './gummyAuthoredPawn'
import type { GummyChessArtStyle, GummyChessMould } from './gummyChessMoulds'

export const GUMMY_COLLIDER_CELL_SIZE = 0.04

/** xyz contains field gradients, w signed distance; padding admits the full particle contact shell. */
export function bakeGummyChessColliderField(
  mould: GummyChessMould,
  artStyle: GummyChessArtStyle = 'classic',
  authoredPawn?: GummyAuthoredPawn,
) {
  if (!isGummyChessMould(mould))
    throw new RangeError('Unknown gummy collider mould')
  const authoredField =
    mould === 'pawn' && authoredPawn
      ? createAuthoredPawnField(authoredPawn)
      : undefined
  const sample =
    authoredField ??
    ((point: readonly [number, number, number]) =>
      gummyChessField(point, mould, artStyle))
  const step = GUMMY_COLLIDER_CELL_SIZE
  const padding = 0.16
  const bounds = GUMMY_CHESS_MOULDS[mould].bounds
  const origin = bounds.min.map(
    (value) => Math.floor((value - padding) / step) * step,
  ) as [number, number, number]
  const size = bounds.max.map(
    (value, axis) => Math.ceil((value + padding - origin[axis]!) / step) + 1,
  ) as [number, number, number]
  const maximum = size.map(
    (value, axis) => origin[axis]! + (value - 1) * step,
  ) as [number, number, number]
  const [nx, ny, nz] = size
  const values = new Float32Array(nx * ny * nz * 4)
  const at = (x: number, y: number, z: number) => ((z * ny + y) * nx + x) * 4
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        values[at(x, y, z) + 3] = sample([
          origin[0] + x * step,
          origin[1] + y * step,
          origin[2] + z * step,
        ])
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const offset = at(x, y, z)
        const low = [Math.max(0, x - 1), Math.max(0, y - 1), Math.max(0, z - 1)]
        const high = [
          Math.min(nx - 1, x + 1),
          Math.min(ny - 1, y + 1),
          Math.min(nz - 1, z + 1),
        ]
        values[offset] =
          (values[at(high[0]!, y, z) + 3]! - values[at(low[0]!, y, z) + 3]!) /
          ((high[0]! - low[0]!) * step)
        values[offset + 1] =
          (values[at(x, high[1]!, z) + 3]! - values[at(x, low[1]!, z) + 3]!) /
          ((high[1]! - low[1]!) * step)
        values[offset + 2] =
          (values[at(x, y, high[2]!) + 3]! - values[at(x, y, low[2]!) + 3]!) /
          ((high[2]! - low[2]!) * step)
      }
  return { origin, maximum, size, step, values }
}
