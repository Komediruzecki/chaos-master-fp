/** Sample the same legal attacker path used for drawing, in the captured rook's local coordinates. */
import { NATIVE_CAPTURE_SECONDS, nativeMatchFrame, nativeMatchPieces, } from './nativeFractalMatchFrame'
import type { ChessMoveReceipt } from '@chaos-master/core/chess/chessGame'
import type { CollectionCloud } from './collectionCloudWorker'
import type { NativeFractalMatchLook } from './nativeFractalMatchFrame'
import type { bakeRookContactShot } from '@/flame/chess/rookContactSolver'
import type { WindowRookFracture } from '@/flame/chess/windowRookFracture'

export type NativeContactInput = {
  receipt: ChessMoveReceipt
  look: NativeFractalMatchLook
  clouds: CollectionCloud[]
  solids?: WindowRookFracture[]
}

export function nativeContactInput(
  input: NativeContactInput,
): Parameters<typeof bakeRookContactShot>[0] | undefined {
  const { receipt, look, clouds, solids } = input
  if (
    look.fracture !== 'contact' ||
    look.collectionId !== 'lattice-court' ||
    receipt.captured?.role !== 'rook'
  )
    return undefined
  const side = receipt.captured.color === 'w' ? 'light' : 'dark'
  const solid = solids?.find((value) => value.key === `rook:${side}`)
  if (!solid?.physics)
    throw new Error(
      'The contact rook could not be prepared. Choose another breakup to continue.',
    )
  const before = nativeMatchPieces(receipt.before, look)
  const victim = before.find((piece) => piece.id === receipt.captured!.id)!
  const attacker = before.find((piece) => piece.id === receipt.pieceId)!
  let bounds = clouds.find((cloud) => cloud.key === attacker.cloudKey)?.bounds
  const attackerSolid =
    attacker.role === 'rook'
      ? solids?.find((value) => value.key === attacker.cloudKey)
      : undefined
  if (attackerSolid?.physics.chunks.length) {
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const chunk of attackerSolid.physics.chunks)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(
          min[axis]!,
          chunk.centroid[axis]! + chunk.localMin[axis]!,
        )
        max[axis] = Math.max(
          max[axis]!,
          chunk.centroid[axis]! + chunk.localMax[axis]!,
        )
      }
    bounds = { min, max }
  }
  if (!bounds) throw new Error('The moving piece has no collision bounds.')
  const sampleRate = 120
  const frameCount = Math.round(NATIVE_CAPTURE_SECONDS * sampleRate) + 1
  const path = new Float32Array(frameCount * 3)
  for (let frame = 0; frame < frameCount; frame++) {
    const moving = nativeMatchFrame(receipt, frame / sampleRate, look).find(
      (piece) => piece.id === receipt.pieceId,
    )!
    for (let axis = 0; axis < 3; axis++)
      path[frame * 3 + axis] =
        (moving.position[axis]! - victim.position[axis]!) / look.scale +
        (axis === 1 ? bounds.min[1] : 0)
  }
  return {
    physics: solid.physics,
    attacker: {
      // A conservative upright collider follows the rendered piece. The rook's
      // own concavity is retained by its disjoint occupied-volume boxes.
      radius: Math.max(
        ...[0, 2].map((axis) =>
          Math.max(Math.abs(bounds.min[axis]!), Math.abs(bounds.max[axis]!)),
        ),
      ),
      height: bounds.max[1] - bounds.min[1],
      path,
    },
    duration: NATIVE_CAPTURE_SECONDS,
    sampleRate,
  }
}
