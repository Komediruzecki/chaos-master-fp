/** Shared playable-board and capture contracts; no component dependencies. */
import type { ChessMoveReceipt, ChessPosition, } from '@chaos-master/core/chess/chessGame'
import type { GummyBoardQuality } from './gummyBoardQuality'
import type { GummyBoardTheme } from './gummyBoardThemes'
import type { GummyPresetSettings } from '@/pages/GummyBear/gummyPresets'
import type { GummyMatchCapturePresentation } from '@/pages/GummyBoard/gummyMatchCaptures'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

export type GummyMatchSceneProps = {
  position: ChessPosition
  receipt?: ChessMoveReceipt
  presentation?: GummyMatchCapturePresentation
  selectedSquare?: string
  legalSquares: readonly string[]
  settings: GummyPresetSettings
  quality: GummyBoardQuality
  scale: number
  theme: GummyBoardTheme
  authoredPawn?: GummyAuthoredPawn
  onSquare: (square: string) => void
  onComplete: (receipt: ChessMoveReceipt) => void
  onError: (message: string) => void
  onReady?: (ready: boolean) => void
}
