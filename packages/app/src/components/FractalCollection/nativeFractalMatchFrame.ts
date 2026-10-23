/** Legal receipts animate native role clouds without replacing their shape or scale. */
import { getFractalStudyGlassRole } from '@/flame/chess/fractalStudyGlass'
import { BOARD_TOP, squareWorld } from '../PawnBoard/pawnBoardMath'
import type { ChessMoveReceipt, ChessPosition, } from '@chaos-master/core/chess/chessGame'
import type { CollectionInstance } from './collectionStageLayout'
import type { Square } from '@/flame/chess/pawnGame'

export type NativeFractalMatchLook = {
  collectionId: string
  enclosure: 'pure' | 'glass'
  scale: number
}
export type NativeFractalMatchPiece = CollectionInstance & {
  id: number
  chessSquare: string
}
export const NATIVE_MOVE_SECONDS = 0.65
export const NATIVE_CAPTURE_IMPACT = 0.9
export const NATIVE_CAPTURE_SECONDS = 2.7

export function nativeMatchSquare(value: string): Square | undefined {
  if (!/^[a-h][1-8]$/.test(value)) return undefined
  return { file: value.charCodeAt(0) - 97, rank: Number(value[1]) - 1 }
}

export function nativeMatchPieces(
  position: ChessPosition,
  look: NativeFractalMatchLook,
  selectedSquare?: string,
): NativeFractalMatchPiece[] {
  const glassRole = getFractalStudyGlassRole(look.collectionId)
  return position.pieces.map((piece) => {
    const square = nativeMatchSquare(piece.square)!
    const side = piece.color === 'w' ? 'light' : 'dark'
    return {
      id: piece.id,
      chessSquare: piece.square,
      square,
      role: piece.role,
      side,
      position: squareWorld(square),
      age: -1,
      selected: piece.square === selectedSquare,
      cloudKey: `${piece.role}:${side}`,
      glassKey:
        look.enclosure === 'glass' && piece.role === glassRole
          ? look.collectionId
          : undefined,
      scale: look.scale,
      colorMultiplier: [1, 1, 1],
    }
  })
}

export function nativeMatchDuration(receipt: ChessMoveReceipt) {
  return receipt.captured ? NATIVE_CAPTURE_SECONDS : NATIVE_MOVE_SECONDS
}

/** Before stays visible until impact; completion returns exactly the committed position. */
export function nativeMatchFrame(
  receipt: ChessMoveReceipt,
  seconds: number,
  look: NativeFractalMatchLook,
): NativeFractalMatchPiece[] {
  const time = Math.max(0, seconds)
  if (time >= nativeMatchDuration(receipt))
    return nativeMatchPieces(receipt.after, look)
  const travel = Math.min(
    1,
    time / (receipt.captured ? 0.95 : NATIVE_MOVE_SECONDS),
  )
  const blend = travel * travel * (3 - 2 * travel)
  return nativeMatchPieces(receipt.before, look).map((piece) => {
    const destination =
      piece.id === receipt.pieceId
        ? receipt.to
        : piece.id === receipt.secondaryMove?.pieceId
          ? receipt.secondaryMove.to
          : undefined
    if (destination) {
      const target = squareWorld(nativeMatchSquare(destination)!)
      if (travel >= 1) return { ...piece, position: target }
      const lift = receipt.captured ? 1.1 : piece.role === 'knight' ? 0.7 : 0.12
      return {
        ...piece,
        position: piece.position.map(
          (value, axis) =>
            value +
            (target[axis]! - value) * blend +
            (axis === 1 ? Math.sin(Math.PI * travel) * lift : 0),
        ) as [number, number, number],
      }
    }
    if (piece.id === receipt.captured?.id && time >= NATIVE_CAPTURE_IMPACT) {
      const age = time - NATIVE_CAPTURE_IMPACT
      return { ...piece, age, glassAge: piece.glassKey ? age : undefined }
    }
    return piece
  })
}

/** Legal move buttons use the native board's top plane, including after orbit and pan. */
export function nativeMatchMarker(square: string, vp: Float32Array) {
  const parsed = nativeMatchSquare(square)
  if (!parsed) return undefined
  const [x, , z] = squareWorld(parsed)
  const y = BOARD_TOP
  const w = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!
  if (w <= 0) return undefined
  const px = (vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!) / w
  const py = (vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!) / w
  if (Math.abs(px) > 1 || Math.abs(py) > 1) return undefined
  return { square, x: (px + 1) * 50, y: (1 - py) * 50 }
}
