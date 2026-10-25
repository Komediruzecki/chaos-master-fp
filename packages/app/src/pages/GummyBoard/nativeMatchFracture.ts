/** Resolve saved capture breakup separately from the collection currently being compared. */
import { effectiveNativeFracture } from '@/flame/chess/nativeFractureTypes'
import { matchesGummyCapture } from './gummyMatchCaptures'
import type { ChessMoveReceipt } from '@chaos-master/core/chess/chessGame'
import type { GummyMatchCapturePresentation } from './gummyMatchCaptures'

export function nativeMatchCaptureFracture(
  receipt: ChessMoveReceipt | undefined,
  presentation: GummyMatchCapturePresentation | undefined,
  collectionId: string,
) {
  if (
    !receipt ||
    !presentation ||
    !matchesGummyCapture(presentation, receipt) ||
    presentation.appearance.nativeCollection?.id !== 'lattice-court' ||
    receipt.captured?.role !== 'rook'
  )
    return 'points'
  return effectiveNativeFracture(
    collectionId,
    presentation.appearance.nativeFracture,
  )
}

export function nativeMatchFractureNotice(
  presentation: GummyMatchCapturePresentation | undefined,
  collectionId: string,
) {
  const saved = presentation?.appearance.nativeFracture
  return presentation?.appearance.nativeCollection?.id === 'lattice-court' &&
    saved &&
    saved !== 'points' &&
    collectionId !== 'lattice-court'
    ? 'This capture keeps its recorded breakup in Lattice Court. Other collections use point breakup.'
    : undefined
}
