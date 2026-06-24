import { example45 } from '@/flame/examples/example45'
import FlameStage from './FlameStage'
import { createFlameParallax } from './useFlameParallax'

/**
 * Live, real-time GPU flame for the hero — the same renderer the editor draws
 * with, reused via FlameStage. Mounted as a `client:only="solid-js"` island.
 *
 * The hero poster sits behind this island as the non-WebGPU fallback; once the
 * flame accumulates we flag the hero (`is-gpu-ready`) so the poster cross-fades
 * out. The cursor parallaxes the camera over the flame (createFlameParallax).
 */
export default function HeroFlame() {
  const cameraPosition = createFlameParallax({
    selector: '.hero',
    base: example45.renderSettings.camera.position,
  })

  return (
    <FlameStage
      flame={example45}
      quality={0.99}
      pointCountPerBatch={256}
      canvasClass="hero-gpu-canvas"
      cameraPosition={cameraPosition}
      onReady={() =>
        document.querySelector('.hero')?.classList.add('is-gpu-ready')
      }
    />
  )
}
