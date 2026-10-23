/** Isolated particle-jelly GPU ownership, fixed-tick pulling and current-state input. */
import { createMemo, createSignal, Show } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { NativeParticleGummyBear } from './NativeParticleGummyBear'
import type { ParticleGummyBearSceneProps } from './particleStudyContracts'

export type { ParticleGummyBearSceneProps } from './particleStudyContracts'

export function ParticleGummyBearScene(props: ParticleGummyBearSceneProps) {
  const [visible, setVisible] = createSignal(true)
  const model = createMemo(() => ({
    fixture: props.fixture ?? 'bear',
    reconstruction: props.reconstruction ?? 'screen-space',
    pinnedFeet: props.fixture === 'blobs' ? false : props.pinnedFeet !== false,
  }))
  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      data-testid="particle-gummy-bear-scene"
    >
      <AutoCanvas
        pixelRatio={1}
        onVisibilityChange={setVisible}
        role="img"
        ariaLabel="Interactive particle jelly. Drag to stretch, Space pauses, arrow keys turn the view, and Shift plus arrows pans. Two fingers pan and pinch to zoom."
      >
        <Show when={model()} keyed>
          {(selected) => (
            <NativeParticleGummyBear
              {...props}
              fixture={selected.fixture}
              reconstruction={selected.reconstruction}
              pinnedFeet={selected.pinnedFeet}
              visible={visible()}
            />
          )}
        </Show>
      </AutoCanvas>
    </div>
  )
}
