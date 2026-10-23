/** Prop-driven resets and selection invalidation within the board canvas owner. */
import { createEffect, on } from 'solid-js'
import type { NativeGummyBoardProps } from './gummyBoardStudyContracts'

type Controls = {
  reset(crash: boolean): void
  cancel(): void
  resetView(): void
  enterDrag(): void
  invalidateSelection(): void
}
export function bindGummyBoardStudyControls(
  props: NativeGummyBoardProps,
  controls: Controls,
) {
  createEffect(
    on(
      () => props.resetKey,
      () => {
        controls.reset(false)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.crashKey,
      () => {
        controls.reset(true)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => [props.view, props.resetViewKey] as const,
      () => {
        controls.cancel()
        controls.resetView()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.mode,
      () => {
        controls.cancel()
        if (props.mode === 'drag') controls.enterDrag()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.pieceScale,
      () => {
        controls.cancel()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.selectedPieceId,
      () => {
        controls.invalidateSelection()
      },
      { defer: true },
    ),
  )
}
