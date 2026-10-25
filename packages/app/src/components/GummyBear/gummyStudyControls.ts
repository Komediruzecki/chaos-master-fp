/** Reactive reset and camera controls, created within the owning study component. */
import { createEffect, on } from 'solid-js'
import type { GummyBearSceneProps } from './gummyStudyContracts'

type Controls = {
  reset(demo: boolean): void
  release(): void
  resetView(): void
}
export function bindGummyStudyControls(
  props: Pick<
    GummyBearSceneProps,
    'resetKey' | 'demoKey' | 'resetViewKey' | 'mode'
  >,
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
      () => props.demoKey,
      () => {
        controls.reset(true)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.resetViewKey,
      () => {
        controls.release()
        controls.resetView()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.mode,
      () => {
        controls.release()
      },
      { defer: true },
    ),
  )
}
