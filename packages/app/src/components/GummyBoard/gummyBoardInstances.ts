/** Bounded board instance packing; stable half-float-exact identities keep optical exits local. */
import { GUMMY_CHESS_MOULDS } from '@/simulation/gummy/gummyChessMoulds'
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { GummyChessMould } from '@/simulation/gummy/gummyChessMoulds'

export type GummyBoardPiece = {
  id: number
  mould: GummyChessMould
  position: readonly [number, number, number]
  side: 0 | 1
  scale?: number
  palette?: GummyPalette
  rotationY?: number
}
export const GUMMY_BOARD_MAX_PIECES = 32
export const GUMMY_BOARD_INSTANCE_FLOATS = 12
export const GUMMY_BOARD_MOULDS = Object.keys(
  GUMMY_CHESS_MOULDS,
) as GummyChessMould[]
export const GUMMY_BOARD_PALETTES: readonly GummyPalette[] = [
  'blue',
  'amber',
  'berry',
  'candy',
  'lagoon',
  'marble',
]

export function gummyBoardPaletteCode(palette?: GummyPalette) {
  if (palette === undefined) return 0
  const index = GUMMY_BOARD_PALETTES.indexOf(palette)
  if (index < 0) throw new Error('Unknown gummy board palette')
  return index + 1
}

export function packGummyBoardInstance(
  target: Float32Array,
  index: number,
  id: number,
  position: readonly [number, number, number],
  side: 0 | 1,
  scale = 1,
  palette?: GummyPalette,
  rotationY = 0,
) {
  if (
    !Number.isInteger(id) ||
    id < 0 ||
    id > 2047 ||
    position.length !== 3 ||
    !position.every(Number.isFinite) ||
    (side !== 0 && side !== 1)
  )
    throw new Error(
      'Gummy board instances require a finite position, side and an exact identity',
    )
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4)
    throw new Error('Gummy board scale must be positive and at most four')
  if (!Number.isFinite(rotationY))
    throw new Error('Gummy board rotation must be finite')
  const paletteCode = gummyBoardPaletteCode(palette)
  const offset = index * GUMMY_BOARD_INSTANCE_FLOATS
  if (
    index < 0 ||
    !Number.isInteger(index) ||
    offset + GUMMY_BOARD_INSTANCE_FLOATS > target.length
  )
    throw new Error('Gummy board instance buffer is too small')
  target[offset] = position[0]
  target[offset + 1] = position[1]
  target[offset + 2] = position[2]
  target[offset + 3] = id + 1
  // A phase shift keeps the same authored palette while varying opposing moulds' marbling.
  target[offset + 4] = side * 0.65
  target[offset + 5] = side * 0.18
  target[offset + 6] = side * -0.35
  target[offset + 7] = scale
  target[offset + 8] = paletteCode
  target[offset + 9] = side
  target[offset + 10] = Math.sin(rotationY)
  target[offset + 11] = Math.cos(rotationY)
}

/** One contiguous range per mould allows six instanced draws, regardless of source ordering. */
export function packGummyBoardInstances(
  target: Float32Array,
  pieces: readonly GummyBoardPiece[],
  victimId?: number,
  secondaryId?: number,
) {
  const activeCount =
    Number(victimId !== undefined) + Number(secondaryId !== undefined)
  const maximumWaiting = GUMMY_BOARD_MAX_PIECES - activeCount
  if (pieces.length > maximumWaiting)
    throw new Error(
      `The gummy board allows ${maximumWaiting} waiting pieces and ${activeCount} simulated pieces`,
    )
  const ids = new Set<number>(victimId === undefined ? [] : [victimId])
  if (secondaryId !== undefined) {
    if (ids.has(secondaryId))
      throw new Error('Gummy board piece identities must be unique')
    ids.add(secondaryId)
  }
  for (const piece of pieces) {
    if (ids.has(piece.id))
      throw new Error('Gummy board piece identities must be unique')
    if (!GUMMY_BOARD_MOULDS.includes(piece.mould))
      throw new Error('Unknown gummy board mould')
    ids.add(piece.id)
  }
  let index = 0
  const ranges = new Map<GummyChessMould, { start: number; count: number }>()
  for (const mould of GUMMY_BOARD_MOULDS) {
    const start = index
    for (const piece of pieces)
      if (piece.mould === mould)
        packGummyBoardInstance(
          target,
          index++,
          piece.id,
          piece.position,
          piece.side,
          piece.scale,
          piece.palette,
          piece.rotationY,
        )
    ranges.set(mould, { start, count: index - start })
  }
  return ranges
}
