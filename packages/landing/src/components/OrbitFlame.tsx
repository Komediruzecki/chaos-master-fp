import { createSignal, Show } from 'solid-js'
import { example44 } from '@/flame/examples/example44'
import { example46 } from '@/flame/examples/example46'
import { useIntersectionObserver } from '@/utils/useIntersectionObserver'
import FlameStage from './FlameStage'
import OpenInApp from './OpenInApp'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * A drag-to-orbit 3D flame for the community showcase cards. Reuses the app's
 * real renderer (Flam3) + WheelZoomCamera3D via FlameView's interactive3D, with a
 * premultiplied (transparent) canvas so the starfield behind it shows through.
 * The live flame mounts only while the card is on-screen and unmounts when
 * scrolled away, so concurrent GPU contexts stay bounded (weak WebGPU impls OOM
 * with many at once). The "Open in app" link is always present.
 */
const FLAMES: Record<string, FlameDescriptor> = {
  earth: example46,
  // Landing render of the rose at high density-estimation quality. The shared app
  // example uses 0.6, which converges slowly / blurs during movement; bump it
  // here (landing-only) so it's crisp immediately like the earth.
  rose: {
    ...example44,
    renderSettings: {
      ...example44.renderSettings,
      densityEstimationQuality: 1,
      estimatorCurve: 0.85,
    },
  },
}

export default function OrbitFlame(props: { which: 'earth' | 'rose' }) {
  const flame = FLAMES[props.which]
  const [container, setContainer] = createSignal<HTMLElement>()
  const intersection = useIntersectionObserver(container)
  const visible = () => intersection()?.isIntersecting ?? false

  return (
    <div class="orbit-mount" ref={setContainer}>
      <Show when={visible()}>
        <FlameStage
          flame={flame}
          quality={0.99}
          pointCountPerBatch={256}
          canvasClass="plate-canvas"
          interactive3D
          autoSpin
          alphaMode="premultiplied"
          outputAlpha
        />
      </Show>
      <OpenInApp flame={flame} />
    </div>
  )
}
