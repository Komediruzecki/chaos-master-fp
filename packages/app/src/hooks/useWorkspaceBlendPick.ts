/**
 * The blend gallery's hover preview, and the pick that commits a partner.
 *
 * Hovering a tile shows the blend by writing the document silently: a hover
 * must not reach the undo stack or the recorder. Leaving the tiles puts back
 * what the document had. A pick commits the partner through
 * `flame.setBlendFlame`.
 */
import { tryValidateFlame } from '@/flame/schema/flameSchema'
import { deepClone } from '@/utils/clone'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

export type UseWorkspaceBlendPickParams = {
  /** The workspace document, read when a preview starts. */
  flame: () => FlameDescriptor
  /** The history's silent writer: no entry, no recorder step. */
  setSilently: (fn: (draft: FlameDescriptor) => void) => void
  /** Runs a registered command against the workspace. */
  execute: (id: string, ...args: unknown[]) => void
}

export function useWorkspaceBlendPick(params: UseWorkspaceBlendPickParams) {
  let prevBlendFlame: FlameDescriptor | undefined
  let prevBlendWeight = 0
  let blendPreviewActive = false

  /** Show `flame` as the partner, or end the preview with `null`. */
  function preview(flame: FlameDescriptor | null): void {
    // The hover preview IS the blend mechanism, and blending is 2D-only:
    // `ifsPipeline3D.update()` takes a single flame — it has no blend input at
    // all, so `renderSettings.blendFlame` is silently ignored in 3D. Writing it
    // anyway changed the hovered NAME while the picture stayed put, which reads
    // as a broken preview rather than an unsupported one. Skip it instead.
    if (flame && (flame.renderSettings.dimensions ?? 2) === 3) {
      return
    }
    if (flame) {
      if (!blendPreviewActive) {
        const stored = params.flame().renderSettings.blendFlame
        prevBlendFlame =
          stored === undefined ? undefined : tryValidateFlame(stored)
        prevBlendWeight = params.flame().renderSettings.blendWeight ?? 0
        blendPreviewActive = true
      }
      params.setSilently((draft) => {
        draft.renderSettings.blendFlame = deepClone(flame)
        draft.renderSettings.blendWeight = 0.4
      })
    } else if (blendPreviewActive) {
      const restore = prevBlendFlame
      const restoreWeight = prevBlendWeight
      params.setSilently((draft) => {
        if (restore === undefined) delete draft.renderSettings.blendFlame
        else draft.renderSettings.blendFlame = deepClone(restore)
        draft.renderSettings.blendWeight = restoreWeight
      })
      prevBlendFlame = undefined
      blendPreviewActive = false
    }
  }

  /** Commit a partner picked in the gallery. */
  function pick(flame: FlameDescriptor): void {
    params.execute('flame.setBlendFlame', flame)
  }

  return { preview, pick }
}
