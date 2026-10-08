/** Owned custom-code registrations keep inspection independent of later variation-library edits. */
import { previewCustomVariation } from '../variations/custom/CustomVariationRegistry'
import { forEachChessCandidateTransform, validateChessCandidate, } from './chessCandidate'
import type { FlameDescriptor } from '../schema/flameSchema'
import type { ChessCandidate } from './chessCandidate'

export type ChessCandidateVariations = {
  flame: FlameDescriptor
  dispose: () => void
}

/** Register isolated IDs only for this render. Dispose after unmounting its renderer, also on stale async results. */
export function createChessCandidateVariations(
  candidate: ChessCandidate,
): Promise<ChessCandidateVariations> {
  return Promise.resolve().then(() => {
    const snapshot = validateChessCandidate(candidate)
    const owned: (() => void)[] = []
    const remap = new Map<string, string>()
    const dispose = () => {
      for (const cleanup of owned.splice(0)) cleanup()
    }
    try {
      for (const definition of snapshot.source.customVariations) {
        const preview = previewCustomVariation(definition.wgsl)
        if (!preview.valid)
          throw new Error(
            `Custom variation ${definition.name} could not compile: ${preview.errors.map((error) => error.message).join('; ')}`,
          )
        owned.push(preview.unregister)
        remap.set(definition.id, preview.id)
      }
      const flame = snapshot.source.flame
      forEachChessCandidateTransform(flame, (transform) => {
        for (const variation of Object.values(transform.variations)) {
          const type = remap.get(variation.type)
          if (type !== undefined) variation.type = type
        }
      })
      return { flame, dispose }
    } catch (error) {
      dispose()
      throw error
    }
  })
}
