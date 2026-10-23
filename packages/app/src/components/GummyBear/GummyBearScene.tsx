/** Owned gummy simulation, bounded fixed steps, and current-position pointer grips. */
import { createMemo, createSignal, Show } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { NativeGummyBear } from './NativeGummyBear'
import type { GummyBearSceneProps, GummyExperiment, GummyGeometry, } from './gummyStudyContracts'
import type { GummyJellyProtocol } from './gummyStudyMath'

export type {
  GummyBearSceneProps,
  GummyExperiment,
  GummyGeometry,
  GummyInteraction,
  GummyPalette,
  GummyStudyStatus,
  GummySurface,
} from './gummyStudyContracts'

export function GummyBearScene(props: GummyBearSceneProps) {
  const [visible, setVisible] = createSignal(true)
  const configuration = createMemo<{
    experiment: GummyExperiment
    protocol: GummyJellyProtocol
    geometry: GummyGeometry
  }>(() => {
    const experiment = props.experiment ?? 'jelly'
    const protocol =
      experiment === 'jelly' ? (props.protocol ?? 'squeeze') : 'squeeze'
    return {
      experiment,
      protocol,
      geometry:
        experiment === 'jelly' && protocol === 'tear'
          ? (props.geometry ?? 'standard')
          : 'standard',
    }
  })
  const canvasLabel = createMemo(() =>
    configuration().experiment === 'jelly' &&
    configuration().protocol === 'tear'
      ? 'Interactive gummy bear. Grab and pull to tear. Space pauses, R resets, arrow keys turn the view, and Shift plus arrows pans. Two fingers pan and pinch to zoom.'
      : 'Interactive gummy bear. D starts the demo, Space pauses, arrow keys turn the view, and Shift plus arrows pans. Two fingers pan and pinch to zoom.',
  )
  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      data-testid="gummy-bear-scene"
    >
      <Show when={configuration()} keyed>
        {(active) => (
          <AutoCanvas
            pixelRatio={1}
            onVisibilityChange={setVisible}
            role="img"
            ariaLabel={canvasLabel()}
          >
            <NativeGummyBear
              {...props}
              experiment={active.experiment}
              protocol={active.protocol}
              geometry={active.geometry}
              visible={visible()}
            />
          </AutoCanvas>
        )}
      </Show>
    </div>
  )
}
