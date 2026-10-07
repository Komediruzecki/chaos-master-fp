/** Rule receipts become render poses; animation never changes the committed chess game. */
import { BOARD_TILE_SIZE } from '@/components/PawnBoard/pawnBoardMath'
import { gummyBoardSquare } from './gummyBoardPosition'
import { GUMMY_BOARD_EARLY_SHEAR_MOTION, resolveGummyBoardShot, } from './gummyBoardShots'
import type { ChessMoveReceipt, ChessPosition, } from '@chaos-master/core/chess/chessGame'
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { GummyRay, GummyVec3 } from '../GummyBear/gummyStudyMath'
import type { GummyBoardPiece } from './gummyBoardChoreography'
import type { GummyBoardShot } from './gummyBoardShots'
import type { GummyBoardTheme } from './gummyBoardThemes'

/** Keep the two sides distinct even when a saved material uses the blue palette. */
export function gummyMatchPalettes(
  palette: GummyPalette,
): readonly [GummyPalette, GummyPalette] {
  return [palette, palette === 'blue' ? 'marble' : 'blue']
}

export function gummyMatchPieces(
  position: ChessPosition,
  scale: number,
  palette: GummyPalette,
) {
  return position.pieces.map(
    (piece): GummyBoardPiece & { scale: number; palette: GummyPalette } => ({
      id: piece.id,
      square: piece.square,
      mould: piece.role,
      position: gummyBoardSquare(piece.square).position,
      side: piece.color === 'w' ? 0 : 1,
      scale,
      palette: gummyMatchPalettes(palette)[piece.color === 'w' ? 0 : 1],
      rotationY:
        piece.role === 'knight'
          ? piece.color === 'w'
            ? Math.PI / 2
            : -Math.PI / 2
          : 0,
    }),
  )
}

/** EP and promotions have explicit lightweight presentation until Cinema supports those captures. */
export function gummyMatchCaptureShot(
  receipt: ChessMoveReceipt,
  theme: GummyBoardTheme,
): GummyBoardShot | undefined {
  if (
    !receipt.captured ||
    receipt.captured.square !== receipt.to ||
    receipt.promotion
  )
    return undefined
  const shot: GummyBoardShot = {
    id: `game-${receipt.ply}-${receipt.lan}`,
    title: receipt.san,
    fen: receipt.before.fen,
    from: receipt.from,
    to: receipt.to,
    boardTheme: theme,
    presetId: 'mid',
    cameraStyle: 'arc',
    motion: { ...GUMMY_BOARD_EARLY_SHEAR_MOTION },
  }
  try {
    resolveGummyBoardShot(shot)
    return shot
  } catch {
    // Valid rule moves must remain playable if an older studio parser cannot present them.
    return undefined
  }
}

export function gummyMatchMoveFrame(
  receipt: ChessMoveReceipt,
  progress: number,
  scale: number,
  palette: GummyPalette,
) {
  const t = Math.max(0, Math.min(1, progress))
  if (t >= 1) return gummyMatchPieces(receipt.after, scale, palette)
  const blend = t * t * (3 - 2 * t)
  return gummyMatchPieces(receipt.before, scale, palette).map((piece) => {
    const destination =
      piece.id === receipt.pieceId
        ? receipt.to
        : piece.id === receipt.secondaryMove?.pieceId
          ? receipt.secondaryMove.to
          : undefined
    if (destination) {
      const target = gummyBoardSquare(destination).position
      return {
        ...piece,
        position: piece.position.map(
          (v, axis) =>
            v +
            (target[axis]! - v) * blend +
            (axis === 1
              ? Math.sin(Math.PI * t) * (piece.mould === 'knight' ? 0.7 : 0.12)
              : 0),
        ) as GummyVec3,
      }
    }
    if (piece.id === receipt.captured?.id)
      return { ...piece, scale: scale * Math.max(0.04, 1 - blend) }
    return piece
  })
}

/** Intersect the actual board plane so empty legal destinations can be tapped. */
export function gummyMatchFloorSquare(ray: GummyRay) {
  if (Math.abs(ray.direction[1]) < 1e-8) return undefined
  const distance = -ray.origin[1] / ray.direction[1]
  if (distance < 0) return undefined
  const x = ray.origin[0] + ray.direction[0] * distance
  const z = ray.origin[2] + ray.direction[2] * distance
  const file = Math.floor(x / BOARD_TILE_SIZE + 4)
  const rank = Math.floor(4 - z / BOARD_TILE_SIZE)
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return undefined
  return `${'abcdefgh'[file]}${rank + 1}`
}

/** Percentage positions let accessible destination buttons track the orbiting board. */
export function gummyMatchSquareMarker(square: string, vp: Float32Array) {
  const [x, , z] = gummyBoardSquare(square).position
  const y = 0.06
  const w = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!
  if (w <= 0) return undefined
  const px = (vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!) / w
  const py = (vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!) / w
  if (Math.abs(px) > 1 || Math.abs(py) > 1) return undefined
  return { square, x: (px + 1) * 50, y: (1 - py) * 50 }
}
