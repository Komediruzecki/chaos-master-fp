/** Freeze an editor flame for chess inspection without replacing its draft. */
import { onCleanup } from 'solid-js'
import { createChessCandidate } from '@/flame/chess/chessCandidate'
import { saveChessCandidateHandoff } from '@/flame/chess/chessCandidateHandoff'
import { saveChessEditorReturn } from '@/flame/chess/chessEditorReturn'
import { IS_NATIVE } from '@/lib/platform'
import { CHESS_FORGE_PATH } from '@/routing/appPath'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { TimelineSnapshot } from '@/flame/schema/timeline'

interface WorkspaceChessInspectionOptions {
  savedFlame: () => FlameDescriptor
  timelineSnapshot: () => TimelineSnapshot
  prepareDocumentReplacement: () => Promise<boolean>
  showToast: (message: string, duration?: number) => unknown
  /** Same-tab navigation disposes every editor renderer before inspection. */
  navigate?: (path: string) => void
}

export function useWorkspaceChessInspection(
  options: WorkspaceChessInspectionOptions,
): (() => Promise<void>) | undefined {
  let pending = false
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  if (IS_NATIVE) return undefined

  return async () => {
    if (pending || disposed) return
    pending = true
    try {
      // Snapshot before any dialog: the candidate belongs to this click, and
      // custom variation definitions travel with the complete source flame.
      const candidate = createChessCandidate(options.savedFlame())
      if (!(await options.prepareDocumentReplacement()) || disposed) return
      saveChessEditorReturn(
        createChessCandidate(options.savedFlame()),
        options.timelineSnapshot(),
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      )
      saveChessCandidateHandoff(candidate)
      const navigate =
        options.navigate ??
        ((path) => {
          window.location.assign(path)
        })
      navigate(CHESS_FORGE_PATH)
    } catch (error) {
      if (!disposed) {
        options.showToast(
          error instanceof Error
            ? error.message
            : 'Could not open chess inspection. Your editor flame is unchanged.',
          6500,
        )
      }
    } finally {
      pending = false
    }
  }
}
