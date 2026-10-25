/** Apply the selected rook material without replacing other roles or the legal final board. */
import type { PreparedNativeContact } from './nativeContactPreparation'
import type { NativeFractalMatchLook, NativeFractalMatchPiece, } from './nativeFractalMatchFrame'

export function applyNativeFracture(
  pieces: NativeFractalMatchPiece[],
  look: NativeFractalMatchLook,
  prepared?: PreparedNativeContact,
  seconds = 0,
): NativeFractalMatchPiece[] {
  if (
    look.collectionId !== 'lattice-court' ||
    !look.fracture ||
    look.fracture === 'points'
  )
    return pieces
  const contact = look.fracture === 'contact'
  const firstBreak =
    prepared?.motion.brokenAt.reduce(
      (first, value) => (value >= 0 ? Math.min(first, value) : first),
      Number.POSITIVE_INFINITY,
    ) ?? Number.POSITIVE_INFINITY
  return pieces.map((piece) => {
    if (piece.role !== 'rook') return piece
    const moving = contact && prepared?.victimId === piece.id
    return {
      ...piece,
      solidKey: piece.cloudKey,
      glassKey: piece.glassKey ? `${piece.glassKey}:solid` : undefined,
      ...(contact
        ? {
            age: -1,
            glassAge:
              moving && seconds >= firstBreak ? seconds - firstBreak : -1,
            solidMotionKey: moving ? prepared.key : undefined,
            solidMotionTime: moving ? seconds : undefined,
          }
        : {}),
    }
  })
}
