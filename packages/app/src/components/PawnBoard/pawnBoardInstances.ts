/** CPU packing and validation for pawn, cloud and board-tile instance buffers. */
import { squareWorld } from './pawnBoardMath'
import type { BoardPawnInstance } from './pawnBoardTypes'
import type { Square } from '@/flame/chess/pawnGame'

export const CAPACITY = 32
const FROST = [0.3, 0.82, 0.92] as const
const EMBER = [1, 0.34, 0.09] as const

export function writeInstance(
  data: Float32Array,
  index: number,
  instance: BoardPawnInstance,
) {
  const o = index * 12
  const colour =
    instance.colorMultiplier ?? (instance.side === 'light' ? FROST : EMBER)
  data[o] = instance.position[0]
  data[o + 1] = instance.position[1]
  data[o + 2] = instance.position[2]
  data[o + 3] = instance.scale ?? 1
  data[o + 4] = colour[0]
  data[o + 5] = colour[1]
  data[o + 6] = colour[2]
  data[o + 7] = 1
  data[o + 8] = instance.age
  data[o + 9] = instance.selected ? 1 : 0
  data[o + 10] = 0
  data[o + 11] = instance.colorMultiplier ? 1 : 0
}

export function fillPieceInstances(
  pieces: readonly BoardPawnInstance[],
  shellData: Float32Array,
  frostData: Float32Array,
  emberData: Float32Array,
  cameraData: Float32Array,
) {
  if (pieces.length > CAPACITY)
    throw new Error('Pawn board instance capacity exceeded')
  let shellCount = 0,
    frostCount = 0,
    emberCount = 0
  for (const piece of pieces) {
    const scale = piece.scale ?? 1
    if (!Number.isFinite(scale) || scale <= 0)
      throw new Error('Board piece scale must be finite and positive')
    if (
      piece.colorMultiplier &&
      (piece.colorMultiplier.length !== 3 ||
        !piece.colorMultiplier.every(
          (value) => Number.isFinite(value) && value >= 0,
        ))
    )
      throw new Error(
        'Board piece colour multiplier must be finite nonnegative RGB',
      )
    // Study clouds have their own shape; the legacy enclosure is a pawn.
    if (piece.cloudKey !== undefined) continue
    if (piece.age < 0 && piece.glassKey === undefined) {
      writeInstance(shellData, shellCount, piece)
      shellData[shellCount * 12 + 10] = shellCount + 1
      const centre = 28 + shellCount * 4
      cameraData[centre] = piece.position[0]
      cameraData[centre + 1] = piece.position[1]
      cameraData[centre + 2] = piece.position[2]
      cameraData[centre + 3] = 0.67 * scale
      shellCount++
    }
    if (piece.side === 'light') writeInstance(frostData, frostCount++, piece)
    else writeInstance(emberData, emberCount++, piece)
  }
  cameraData[24] = shellCount
  return { shellCount, frostCount, emberCount }
}

export function fillTiles(
  data: Float32Array,
  selected: Square | undefined,
  legal: readonly Square[],
) {
  for (let rank = 0; rank < 8; rank++)
    for (let file = 0; file < 8; file++) {
      const o = (rank * 8 + file) * 12,
        position = squareWorld({ file, rank })
      data[o] = position[0]
      data[o + 1] = -0.01
      data[o + 2] = position[2]
      data[o + 3] = 1
      const pale = (rank + file) % 2 === 0
      data[o + 4] = pale ? 0.11 : 0.029
      data[o + 5] = pale ? 0.15 : 0.046
      data[o + 6] = pale ? 0.18 : 0.064
      data[o + 7] = 1
      data[o + 8] = -1
      data[o + 9] = legal.some((s) => s.file === file && s.rank === rank)
        ? 0.55
        : 0
      if (selected?.file === file && selected.rank === rank) data[o + 9] = 1
    }
}
