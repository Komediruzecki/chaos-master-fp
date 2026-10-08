/** One contact-plane grid for gummy pieces, glass insets, picking and move markers. */
import { BOARD_TILE_SIZE } from '../PawnBoard/pawnBoardMath'
import type { GummyVec3 } from '../GummyBear/gummyStudyMath'

export const GUMMY_BOARD_GRID = {
  squares: 8,
  squareSize: BOARD_TILE_SIZE,
  halfExtent: 4 * BOARD_TILE_SIZE,
  top: 0,
} as const

export const GUMMY_BOARD_SLAB = {
  halfExtent: GUMMY_BOARD_GRID.halfExtent + 0.25,
  bevel: 0.08,
  bottom: GUMMY_BOARD_GRID.top - 0.32,
} as const

export function gummyBoardGridCentre(file: number, rank: number): GummyVec3 {
  const centre = (GUMMY_BOARD_GRID.squares - 1) / 2
  return [
    (file - centre) * GUMMY_BOARD_GRID.squareSize,
    GUMMY_BOARD_GRID.top,
    (centre - rank) * GUMMY_BOARD_GRID.squareSize,
  ]
}

/** Half-open file/rank cells match the shader, including internal grid boundaries. */
export function gummyBoardGridSquare(x: number, z: number) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined
  const half = GUMMY_BOARD_GRID.squares / 2
  const file = Math.floor(x / GUMMY_BOARD_GRID.squareSize + half)
  const rank = Math.floor(half - z / GUMMY_BOARD_GRID.squareSize)
  if (
    file < 0 ||
    file >= GUMMY_BOARD_GRID.squares ||
    rank < 0 ||
    rank >= GUMMY_BOARD_GRID.squares
  )
    return undefined
  return `${'abcdefgh'[file]}${rank + 1}`
}
